FROM ubuntu:focal

RUN apt-get update && \
    apt-get install -y curl git && \
    curl -sL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get upgrade -y && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/app

# Copy package files first to leverage Docker cache
COPY package*.json ./
RUN npm install

# Copy script files
COPY main.sh script.js kafka.pem ./

# Make sure script has proper line endings and permissions
RUN apt-get update && \
    apt-get install -y dos2unix && \
    dos2unix /home/app/main.sh && \
    chmod +x /home/app/main.sh /home/app/script.js && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Verify the script exists and is executable
RUN ls -la /home/app/ && \
    file /home/app/main.sh

ENTRYPOINT ["/home/app/main.sh"]
