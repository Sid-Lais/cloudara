const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@clickhouse/client');

const prisma = new PrismaClient();
const clickhouse = createClient({
    host: '',
    database: '',
    username: '',
    password: ''
});

async function syncProjects() {
    try {
        // Get all projects from PostgreSQL
        const projects = await prisma.project.findMany();

        // Insert each project into ClickHouse
        for (const project of projects) {
            await clickhouse.query({
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
                    id: project.id,
                    name: project.name,
                    gitURL: project.gitURL,
                    subdomain: project.subDomain,
                    customDomain: project.customDomain || '',
                    createdAt: project.createdAt.toISOString(),
                    updatedAt: project.updatedAt.toISOString()
                }
            });

            console.log(`Synced project: ${project.name} (${project.id})`);
        }

        console.log(`Synced ${projects.length} projects to ClickHouse`);
    } catch (error) {
        console.error("Error syncing projects:", error);
    }
}

async function syncDeployments() {
    try {
        // Get all deployments from PostgreSQL
        const deployments = await prisma.deployement.findMany();

        // Insert each deployment into ClickHouse
        for (const deployment of deployments) {
            await clickhouse.query({
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
                    id: deployment.id,
                    projectId: deployment.projectId,
                    status: deployment.status,
                    createdAt: deployment.createdAt.toISOString(),
                    updatedAt: deployment.updatedAt.toISOString()
                }
            });

            console.log(`Synced deployment: ${deployment.id}`);
        }

        console.log(`Synced ${deployments.length} deployments to ClickHouse`);
    } catch (error) {
        console.error("Error syncing deployments:", error);
    }
}

async function main() {
    try {
        // Create tables if they don't exist
        await clickhouse.query({
            query: `
                CREATE TABLE IF NOT EXISTS project (
                    id String,
                    name String,
                    git_url String,
                    subdomain String,
                    custom_domain Nullable(String),
                    created_at DateTime DEFAULT now(),
                    updated_at DateTime DEFAULT now()
                ) ENGINE = MergeTree()
                ORDER BY (id)
            `
        });

        await clickhouse.query({
            query: `
                CREATE TABLE IF NOT EXISTS deployement (
                    id String,
                    project_id String,
                    status String,
                    created_at DateTime DEFAULT now(),
                    updated_at DateTime DEFAULT now()
                ) ENGINE = MergeTree()
                ORDER BY (id, project_id)
            `
        });

        // Sync data
        await syncProjects();
        await syncDeployments();

        console.log("Data synchronization complete");
    } catch (error) {
        console.error("Sync error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
