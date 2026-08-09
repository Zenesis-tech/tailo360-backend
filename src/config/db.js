const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);
// Never leave API requests waiting in Mongoose's in-memory buffer when Atlas
// is unreachable. The API error middleware will return a retryable 503.
mongoose.set('bufferCommands', false);

const connectionStates = [
  'disconnected',
  'connected',
  'connecting',
  'disconnecting',
  'uninitialized',
];

let listenersInstalled = false;
let connectionPromise;
function installConnectionLogging() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  mongoose.connection.on('connected', () => {
    console.log('MongoDB connection established');
  });
  mongoose.connection.on('disconnected', () => {
    console.error('MongoDB connection lost; the driver will keep retrying');
  });
  mongoose.connection.on('error', (error) => {
    console.error('MongoDB connection error', {
      name: error?.name,
      message: error?.message,
    });
  });
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;
  installConnectionLogging();
  connectionPromise = mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 60000,
    retryReads: true,
    retryWrites: true,
    // Avoid connection stalls on hosts that advertise IPv6 without routing it.
    family: 4,
  });
  try {
    return await connectionPromise;
  } finally {
    connectionPromise = undefined;
  }
}

function databaseStatus() {
  const readyState = mongoose.connection.readyState;
  return {
    ready: readyState === 1,
    state: connectionStates[readyState] || 'unknown',
  };
}

module.exports = { connectDatabase, databaseStatus };
