const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/otkliks';

async function connectDb() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB:', MONGO_URI);
}

module.exports = { connectDb };
