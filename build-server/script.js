const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const mime = require('mime-types')
const { Kafka } = require('kafkajs')

const s3Client = new S3Client({
    region: '',
    credentials: {
        accessKeyId: '',
        secretAccessKey: ''
    }
})

const PROJECT_ID = process.env.PROJECT_ID
const DEPLOYEMENT_ID = process.env.DEPLOYEMENT_ID

const kafka = new Kafka({
    clientId: `docker-build-server-${DEPLOYEMENT_ID}`,
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

const producer = kafka.producer()

async function publishLog(log) {
    await producer.send({ topic: `container-logs`, messages: [{ key: 'log', value: JSON.stringify({ PROJECT_ID, DEPLOYEMENT_ID, log }) }] })
}

// Add this function to update deployment status
async function updateDeploymentStatus(status) {
    try {
        console.log(`Updating deployment ${DEPLOYEMENT_ID} status to ${status}`);
        const response = await fetch('http://host.docker.internal:9000/update-deployment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deploymentId: DEPLOYEMENT_ID,
                status
            })
        });

        if (!response.ok) {
            console.error('Failed to update deployment status:', await response.text());
        }
    } catch (error) {
        console.error('Error updating deployment status:', error);
    }
}

// Update your upload function
async function uploadFile(file) {
    const filePath = path.join(OUTPUT_DIR, file);

    if (fs.lstatSync(filePath).isDirectory()) {
        return;
    }

    await publishLog(`uploading ${file}`);

    console.log('Uploading to S3 with PROJECT_ID:', PROJECT_ID);

    const command = new PutObjectCommand({
        Bucket: '',
        Key: `__outputs/${PROJECT_ID}/${file}`,
        Body: fs.createReadStream(filePath),
        ContentType: mime.lookup(filePath) || 'application/octet-stream',
        ACL: 'public-read'
    });

    await s3Client.send(command);
    await publishLog(`uploaded ${file}`);
}

async function init() {

    await producer.connect()

    console.log('Executing script.js')
    await publishLog('Build Started...')
    const outDirPath = path.join(__dirname, 'output')

    const p = exec(`cd ${outDirPath} && npm install && npm run build`)

    p.stdout.on('data', function (data) {
        console.log(data.toString())
        publishLog(data.toString())
    })

    p.stdout.on('error', async function (data) {
        console.log('Error', data.toString())
        await publishLog(`error: ${data.toString()}`)
    })

    // Update the 'close' handler - after all uploads complete
    p.on('close', async function () {
        console.log('Build Complete')
        await publishLog(`Build Complete`)
        const distFolderPath = path.join(__dirname, 'output', 'dist')
        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })

        await publishLog(`Starting to upload`)
        for (const file of distFolderContents) {
            const filePath = path.join(distFolderPath, file)
            if (fs.lstatSync(filePath).isDirectory()) continue;

            console.log('uploading', filePath)
            await publishLog(`uploading ${file}`)

            const command = new PutObjectCommand({
                Bucket: '',
                Key: `__outputs/${PROJECT_ID}/${file}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath)
            })

            await s3Client.send(command)
            publishLog(`uploaded ${file}`)
            console.log('uploaded', filePath)
        }
        // After all uploads and before exit
        await publishLog(`Updating deployment status to READY`);
        await updateDeploymentStatus('READY');
        await publishLog(`Done`)
        console.log('Done...')
        process.exit(0)
    })
}

init()
