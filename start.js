const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Configuration
const services = [
  {
    name: 'API Server',
    color: '\x1b[36m', // Cyan
    dir: path.join(__dirname, 'api-server'),
    command: 'node',
    args: ['index.js'],
    ready: (output) => output.includes('API Server Running')
  },
  {
    name: 'S3 Reverse Proxy',
    color: '\x1b[33m', // Yellow
    dir: path.join(__dirname, 's3-reverse-proxy'),
    command: 'node',
    args: ['index.js'],
    ready: (output) => output.includes('Reverse Proxy Running')
  },
  {
    name: 'Frontend',
    color: '\x1b[35m', // Magenta
    dir: path.join(__dirname, 'frontend-nextjs'),
    command: 'npm',
    args: ['run', 'dev'],
    ready: (output) => output.includes('ready started')
  }
];

// ANSI color reset
const reset = '\x1b[0m';

// Helper to create a prefixed logger
function createLogger(name, color) {
  return (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${color}[${name}]${reset} ${line}`);
      }
    });
  };
}

// Check if all required directories exist
const missingDirs = services.filter(service => !fs.existsSync(service.dir));
if (missingDirs.length > 0) {
  console.error('\x1b[31mError: The following service directories are missing:\x1b[0m');
  missingDirs.forEach(service => {
    console.error(`  - ${service.dir}`);
  });
  process.exit(1);
}

console.log('\x1b[32m=== Starting All Services ===\x1b[0m');

// Start all services
const processes = services.map(service => {
  console.log(`${service.color}Starting ${service.name}...${reset}`);

  const proc = spawn(service.command, service.args, {
    cwd: service.dir,
    shell: true
  });

  // Setup logging
  const logOutput = createLogger(service.name, service.color);
  const logError = createLogger(`${service.name} (ERROR)`, '\x1b[31m');

  proc.stdout.on('data', (data) => {
    logOutput(data);
    if (service.ready && service.ready(data.toString()) && !service.isReady) {
      service.isReady = true;
      console.log(`\x1b[32m[${service.name}] Service is ready!\x1b[0m`);
    }
  });

  proc.stderr.on('data', logError);

  proc.on('close', (code) => {
    console.log(`${service.color}[${service.name}] process exited with code ${code}${reset}`);
  });

  return proc;
});

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n\x1b[33mShutting down all services...\x1b[0m');
  processes.forEach((proc, i) => {
    const service = services[i];
    console.log(`${service.color}Stopping ${service.name}...${reset}`);
    proc.kill('SIGTERM');
  });
};

// Listen for terminal signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Setup command interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[32m> \x1b[0m'
});

console.log('\x1b[32m=== Command Interface ===\x1b[0m');
console.log('Available commands:');
console.log('  r, restart <service> - Restart a specific service (api, proxy, frontend)');
console.log('  q, quit             - Quit all services');
console.log('  h, help             - Show this help message\n');

rl.prompt();

rl.on('line', (line) => {
  const [command, ...args] = line.trim().split(' ');

  switch (command.toLowerCase()) {
    case 'r':
    case 'restart':
      if (args.length > 0) {
        const serviceArg = args[0].toLowerCase();
        let serviceIndex = -1;

        if (serviceArg === 'api') serviceIndex = 0;
        else if (serviceArg === 'proxy') serviceIndex = 1;
        else if (serviceArg === 'frontend') serviceIndex = 2;

        if (serviceIndex >= 0) {
          console.log(`\x1b[33mRestarting ${services[serviceIndex].name}...\x1b[0m`);
          processes[serviceIndex].kill('SIGTERM');

          // Wait a bit and start the service again
          setTimeout(() => {
            const service = services[serviceIndex];
            processes[serviceIndex] = spawn(service.command, service.args, {
              cwd: service.dir,
              shell: true
            });

            const logOutput = createLogger(service.name, service.color);
            const logError = createLogger(`${service.name} (ERROR)`, '\x1b[31m');

            processes[serviceIndex].stdout.on('data', logOutput);
            processes[serviceIndex].stderr.on('data', logError);
          }, 1000);
        } else {
          console.log('\x1b[31mInvalid service. Use api, proxy, or frontend.\x1b[0m');
        }
      } else {
        console.log('\x1b[31mPlease specify a service to restart (api, proxy, frontend).\x1b[0m');
      }
      break;

    case 'q':
    case 'quit':
      console.log('\x1b[33mQuitting...\x1b[0m');
      shutdown();
      setTimeout(() => process.exit(0), 1000);
      break;

    case 'h':
    case 'help':
      console.log('\x1b[32m=== Command Interface ===\x1b[0m');
      console.log('Available commands:');
      console.log('  r, restart <service> - Restart a specific service (api, proxy, frontend)');
      console.log('  q, quit             - Quit all services');
      console.log('  h, help             - Show this help message');
      break;

    default:
      console.log('\x1b[31mUnknown command. Type "help" for available commands.\x1b[0m');
  }

  rl.prompt();
}).on('close', () => {
  shutdown();
  process.exit(0);
});
