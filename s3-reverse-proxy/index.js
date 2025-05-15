const express = require('express');
const httpProxy = require('http-proxy');
const axios = require('axios');

const app = express();
const PORT = 8000;
const API_SERVER = 'http://localhost:9000';

// Memory cache for subdomain to project ID mapping
const subdomainCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

const BASE_PATH = '';

const proxy = httpProxy.createProxy();

// Add error handling to the proxy
proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + err.message);
});

// Debug proxy responses
proxy.on('proxyRes', (proxyRes, req, res) => {
    console.log(`Proxy response: ${proxyRes.statusCode} for ${req.hostname}${req.url}`);
});

// Handle URL rewriting to add index.html to root paths
proxy.on('proxyReq', (proxyReq, req, res) => {
    const url = req.url;
    if (url === '/') {
        proxyReq.path += 'index.html';
    }
});

// Function to look up project ID by subdomain
async function getProjectIdBySubdomain(subdomain) {
    // Check cache first
    const cachedData = subdomainCache.get(subdomain);
    if (cachedData && cachedData.timestamp > Date.now() - CACHE_TTL) {
        console.log(`Using cached projectId for ${subdomain}: ${cachedData.projectId}`);
        return cachedData.projectId;
    }

    try {
        console.log(`Fetching project data for subdomain: ${subdomain}`);
        const response = await axios.get(`${API_SERVER}/project/lookup/${subdomain}`);

        if (response.data && response.data.status === 'success') {
            const projectId = response.data.data.projectId;

            // Update cache
            subdomainCache.set(subdomain, {
                projectId,
                timestamp: Date.now()
            });

            console.log(`Found projectId for ${subdomain}: ${projectId}`);
            return projectId;
        } else {
            console.log(`No project found for subdomain: ${subdomain}`);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching project data for ${subdomain}:`,
            error.response?.status, error.response?.data || error.message);
        return null;
    }
}

// Main request handler
app.use(async (req, res) => {
    try {
        const hostname = req.hostname;
        const subdomain = hostname.split('.')[0];

        console.log(`Request for subdomain: ${subdomain}`);

        // Get project ID for this subdomain
        const projectId = await getProjectIdBySubdomain(subdomain);

        if (!projectId) {
            console.log(`No project ID found for subdomain: ${subdomain}`);
            return res.status(404).send(`
                <html>
                <head><title>Project Not Found</title></head>
                <body>
                    <h1>Project Not Found</h1>
                    <p>We couldn't find a project for subdomain: ${subdomain}</p>
                </body>
                </html>
            `);
        }

        // Construct target URL with the UUID
        const resolvesTo = `${BASE_PATH}/${projectId}`;
        console.log(`Proxying request for ${subdomain} to ${resolvesTo}`);

        return proxy.web(req, res, {
            target: resolvesTo,
            changeOrigin: true,
            ignorePath: false,
            autoRewrite: true,
            secure: false
        });
    } catch (error) {
        console.error('Error in request handling:', error);
        res.status(500).send('Internal server error');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Reverse Proxy Running on port ${PORT}`);
});
