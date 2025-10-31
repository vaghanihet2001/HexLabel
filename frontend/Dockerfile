FROM node:18-bullseye

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY .env .env

# Force install all deps including devDependencies
RUN npm install --include=dev

# Copy the rest of the files
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
