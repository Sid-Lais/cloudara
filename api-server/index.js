const express = require('express')
const { generateSlug } = require('random-word-slugs')
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')
const { Server } = require('socket.io')
const cors = require('cors')
const { z } = require('zod')
const { PrismaClient } = require('@prisma/client')
const { createClient } = require('@clickhouse/client')
const { Kafka } = require('kafkajs')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')


const app = express()
const PORT = 9000

const prisma = new PrismaClient({})

const io = new Server({ cors: '*' })

const kafka = new Kafka({
    clientId: `api-server`,
    brokers: [''],
    ssl: {
        ca: [fs.readFileSync(path.join(__dirname, 'kafka.pem'), 'utf-8')]
    },
    sasl: {
        username: '',
        password: '',
        mechanism: ''
    }

})

const client = createClient({
    host: '',
    database: '',
    username: '',
    password: ''
})

const consumer = kafka.consumer({ groupId: 'api-server-logs-consumer' })

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', JSON.stringify({ log: `Subscribed to ${channel}` }))
    })
})

io.listen(9002, () => console.log('Socket Server 9002'))

const ecsClient = new ECSClient({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: '',
        secretAccessKey: ''
    }
})

const config = {
    CLUSTER: '',
    TASK: ''
}

app.use(express.json())
app.use(cors())

// Replace the current syncToClickHouse function with this improved version
async function syncToClickHouse(type, data) {
    try {
        // Format datetime properly for ClickHouse (strip off milliseconds and timezone)
        const formatDate = (date) => {
            if (!date) return null;
            // Convert ISO string to format that ClickHouse accepts: YYYY-MM-DD HH:MM:SS
            return date.toISOString().replace('T', ' ').substring(0, 19);
        };

        if (type === 'project') {
            await client.query({
                query: `
                    INSERT INTO project (id, name, git_url, subdomain, custom_domain, created_at, updated_at)
                    VALUES (
                        {id: String},
                        {name: String},
                        {gitURL: String},
                        {subdomain: String},
                        {customDomain: String},
                        {createdAt: DateTime},
                        {updatedAt: DateTime}
                    )
                `,
                query_params: {
                    id: data.id,
                    name: data.name,
                    gitURL: data.gitURL,
                    subdomain: data.subDomain,
                    customDomain: data.customDomain || '',
                    createdAt: formatDate(data.createdAt),
                    updatedAt: formatDate(data.updatedAt)
                }
            });
            console.log(`Synced project ${data.id} to ClickHouse`);
        } else if (type === 'deployment') {
            await client.query({
                query: `
                    INSERT INTO deployement (id, project_id, status, created_at, updated_at)
                    VALUES (
                        {id: String},
                        {projectId: String},
                        {status: String},
                        {createdAt: DateTime},
                        {updatedAt: DateTime}
                    )
                `,
                query_params: {
                    id: data.id,
                    projectId: data.projectId,
                    status: data.status,
                    createdAt: formatDate(data.createdAt),
                    updatedAt: formatDate(data.updatedAt)
                }
            });
            console.log(`Synced deployment ${data.id} to ClickHouse`);
        }
    } catch (error) {
        console.error(`Error syncing ${type} to ClickHouse:`, error);
    }
}

// Then modify your /project endpoint:
app.post('/project', async (req, res) => {
    const schema = z.object({
        name: z.string(),
        gitURL: z.string()
    });
    const safeParseResult = schema.safeParse(req.body);

    if (safeParseResult.error) return res.status(400).json({ error: safeParseResult.error });

    const { name, gitURL } = safeParseResult.data;

    const project = await prisma.project.create({
        data: {
            name,
            gitURL,
            subDomain: generateSlug()
        }
    });

    // Sync to ClickHouse
    await syncToClickHouse('project', project);

    return res.json({ status: 'success', data: { project } });
});

// And your /deploy endpoint:
app.post('/deploy', async (req, res) => {
    const { projectId } = req.body;

    if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });

    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Check if there is no running deployement
    const deployment = await prisma.deployement.create({
        data: {
            project: { connect: { id: projectId } },
            status: 'QUEUED',
        }
    });

    // Sync to ClickHouse
    await syncToClickHouse('deployment', deployment);

    // Spin the container
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: ['', '', ''],
                securityGroups: ['']
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'builder-image',
                    environment: [
                        { name: 'GIT_REPOSITORY__URL', value: project.gitURL },
                        { name: 'PROJECT_ID', value: projectId },
                        { name: 'DEPLOYEMENT_ID', value: deployment.id },
                    ]
                }
            ]
        }
    })

    await ecsClient.send(command);

    return res.json({ status: 'queued', data: { deploymentId: deployment.id } })

})

// Update the /update-deployment endpoint:
app.post('/update-deployment', async (req, res) => {
    const { deploymentId, status } = req.body;

    if (!deploymentId || !status) {
        return res.status(400).json({ error: 'Deployment ID and status are required' });
    }

    try {
        const deployment = await prisma.deployement.update({
            where: { id: deploymentId },
            data: { status }
        });

        // Sync to ClickHouse
        await syncToClickHouse('deployment', deployment);

        return res.json({ status: 'success', data: { deployment } });
    } catch (error) {
        console.error('Error updating deployment:', error);
        return res.status(500).json({ error: 'Failed to update deployment status' });
    }
});

app.get('/logs/:id', async (req, res) => {
    const id = req.params.id;
    const logs = await client.query({
        query: `SELECT event_id, deployment_id, log, timestamp from log_events where deployment_id = {deployment_id:String}`,
        query_params: {
            deployment_id: id
        },
        format: 'JSONEachRow'
    })

    const rawLogs = await logs.json()

    return res.json({ logs: rawLogs })
})

// Add this new endpoint
app.get('/project/subdomain/:subdomain', async (req, res) => {
    const { subdomain } = req.params;

    if (!subdomain) {
        return res.status(400).json({ error: 'Subdomain is required' });
    }

    try {
        const project = await prisma.project.findFirst({
            where: { subDomain: subdomain },
            include: {
                Deployement: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        return res.json({
            status: 'success',
            data: {
                project: {
                    id: project.id,
                    name: project.name,
                    subdomain: project.subDomain,
                    latestDeployment: project.Deployement[0] || null
                }
            }
        });
    } catch (error) {
        console.error('Error finding project by subdomain:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

// Add this endpoint to look up a project by subdomain
app.get('/project/lookup/:subdomain', async (req, res) => {
    try {
        const { subdomain } = req.params;

        if (!subdomain) {
            return res.status(400).json({ error: 'Subdomain is required' });
        }

        // Find the project by subdomain
        const project = await prisma.project.findFirst({
            where: { subDomain: subdomain }
        });

        if (!project) {
            return res.status(404).json({
                status: 'error',
                error: 'Project not found'
            });
        }

        return res.json({
            status: 'success',
            data: {
                projectId: project.id,
                name: project.name,
                subdomain: project.subDomain
            }
        });
    } catch (error) {
        console.error('Error looking up project by subdomain:', error);
        return res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});

async function initkafkaConsumer() {
    await consumer.connect();
    await consumer.subscribe({ topics: ['container-logs'], fromBeginning: true })

    await consumer.run({

        eachBatch: async function ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {

            const messages = batch.messages;
            console.log(`Recv. ${messages.length} messages..`)
            for (const message of messages) {
                if (!message.value) continue;
                const stringMessage = message.value.toString()
                const { PROJECT_ID, DEPLOYEMENT_ID, log } = JSON.parse(stringMessage)
                console.log({ log, DEPLOYEMENT_ID })
                try {
                    const { query_id } = await client.insert({
                        table: 'log_events',
                        values: [{ event_id: uuidv4(), deployment_id: DEPLOYEMENT_ID, log }],
                        format: 'JSONEachRow'
                    })
                    console.log(query_id)
                    resolveOffset(message.offset)
                    await commitOffsetsIfNecessary(message.offset)
                    await heartbeat()
                } catch (err) {
                    console.log(err)
                }

            }
        }
    })
}

initkafkaConsumer()

app.listen(PORT, () => console.log(`API Server Running..${PORT}`))
