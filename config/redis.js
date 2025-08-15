const redis = require('redis');
const redisClient = redis.createClient({
  host: '127.0.0.1', // Default
  port: 6379,        // Default
  password: process.env.REDIS_PASSWORD || '', // If set in redis.conf
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});

redisClient.connect().then(() => {
  console.log('Connected to Redis');
});

module.exports = redisClient;