const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'subdomain-cache.json');

// Load the cache from disk
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading subdomain cache:', error);
    }
    return {};
}

// Save the cache to disk
function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving subdomain cache:', error);
    }
}

// Add or update a subdomain mapping
function setSubdomainMapping(subdomain, projectId) {
    const cache = loadCache();
    cache[subdomain] = projectId;
    saveCache(cache);
}

// Get a project ID from subdomain
function getProjectId(subdomain) {
    const cache = loadCache();
    return cache[subdomain];
}

module.exports = {
    loadCache,
    saveCache,
    setSubdomainMapping,
    getProjectId
};
