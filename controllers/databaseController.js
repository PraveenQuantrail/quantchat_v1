const { Sequelize } = require('sequelize');
const { createClient } = require('@clickhouse/client');
const DatabaseConnection = require('../models/databaseModels');
const usersController = require('./usersController');

// Helper function to detect if a host is a cloud database
function isCloudDatabase(host, type) {
  if (!host) return false;
  
  const cloudDomains = [
    // AWS
    '.amazonaws.com', '.aws.', '.rds.amazonaws.com',
    // Google Cloud
    '.gcp.', '.googleapis.com', '.cloud.google.com',
    // Azure
    '.azure.com', '.database.azure.com', '.windows.net',
    // DigitalOcean
    '.digitaloceanspaces.com', '.ondigitalocean.com',
    // Other cloud providers
    '.cloud.', '.tidbcloud.com', '.scalegrid.com',
    '.aivencloud.com', '.clever-cloud.com',
    // Common cloud patterns
    'gateway01.', 'gateway02.', 'gateway03.',
    'proxy-', 'cluster-', 'shard-'
  ];

  const hostLower = host.toLowerCase();
  
  // Check for cloud domain patterns
  for (const domain of cloudDomains) {
    if (hostLower.includes(domain)) {
      return true;
    }
  }

  // Check for IP addresses (cloud databases rarely use raw IPs)
  const ipPattern = /^\d+\.\d+\.\d+\.\d+$/;
  if (ipPattern.test(host)) {
    return false; // More likely to be local/internal
  }

  return false;
}

// Helper function to extract host from connection string
function extractHostFromConnectionString(connectionString, type) {
  if (!connectionString) return null;

  try {
    if (type === 'ClickHouse') {
      // ClickHouse: http://username:password@host:port/database
      const match = connectionString.match(/:\/\/(?:[^:@]+:[^@]+@)?([^:\/]+)/);
      return match ? match[1] : null;
    } else {
      // PostgreSQL/MySQL: postgres://user:pass@host:port/db
      const match = connectionString.match(/:\/\/(?:[^:@]+:[^@]+@)?([^:\/]+)/);
      return match ? match[1] : null;
    }
  } catch (error) {
    return null;
  }
}

// Helper function to extract database name from connection string
function extractDatabaseFromConnectionString(connectionString, type) {
  if (!connectionString) return null;

  try {
    if (type === 'ClickHouse') {
      // ClickHouse: http://username:password@host:port/database
      const match = connectionString.match(/:\/\/[^\/]+\/([^?]+)/);
      return match ? match[1] : 'default';
    } else {
      // PostgreSQL/MySQL: postgres://user:pass@host:port/db
      const match = connectionString.match(/:\/\/[^\/]+\/([^?]+)/);
      return match ? match[1] : null;
    }
  } catch (error) {
    return null;
  }
}

// Helper function to normalize connection for comparison
function normalizeConnectionForComparison(connection) {
  const normalized = {
    type: connection.type,
    database: connection.database
  };

  if (connection.server_type === 'local') {
    normalized.host = connection.host?.toLowerCase() || '';
    normalized.port = connection.port || '';
  } else {
    // For external connections, extract the essential host
    const extractedHost = extractHostFromConnectionString(connection.connection_string, connection.type);
    normalized.host = extractedHost?.toLowerCase() || '';
    // For external, we consider the connection string as the identifier
    normalized.connection_string = connection.connection_string || '';
  }

  return normalized;
}

// Helper function to check if connections represent the same database
function isSameDatabase(conn1, conn2) {
  const norm1 = normalizeConnectionForComparison(conn1);
  const norm2 = normalizeConnectionForComparison(conn2);

  // If types or database names don't match, they're different
  if (norm1.type !== norm2.type || norm1.database !== norm2.database) {
    return false;
  }

  // If both have hosts and they match, they're the same
  if (norm1.host && norm2.host && norm1.host === norm2.host) {
    return true;
  }

  // If one is external and contains the other's host in connection string
  if (conn1.server_type === 'external' && conn2.server_type === 'local') {
    return norm1.connection_string.includes(norm2.host);
  }
  if (conn2.server_type === 'external' && conn1.server_type === 'local') {
    return norm2.connection_string.includes(norm1.host);
  }

  return false;
}

// Helper function to validate database name in connection string
function validateDatabaseName(connectionString, providedDatabaseName, type) {
  if (!connectionString) return { valid: false, message: 'Connection string is required' };

  const extractedDatabase = extractDatabaseFromConnectionString(connectionString, type);
  
  if (!extractedDatabase) {
    // If no database found in connection string, use the provided one
    return { valid: true, actualDatabase: providedDatabaseName };
  }

  if (extractedDatabase !== providedDatabaseName) {
    return { 
      valid: false, 
      message: `Database name mismatch. Connection string contains database '${extractedDatabase}' but you entered '${providedDatabaseName}'. Please use the correct database name.`,
      actualDatabase: extractedDatabase
    };
  }

  return { valid: true, actualDatabase: extractedDatabase };
}

async function createClickHouseClient(config, connectionDetails) {
  try {
    const client = createClient(config);
    
    // Test the connection with a simple query
    await client.query({
      query: 'SELECT 1 as test',
      format: 'JSONEachRow'
    });
    
    return client;
  } catch (error) {
    console.error('ClickHouse connection failed:', error);
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Connection refused to ${connectionDetails.host}:${connectionDetails.port || 8123}. Please ensure ClickHouse server is running and accessible.`);
    } else if (error.code === 'ENOTFOUND') {
      throw new Error(`Host ${connectionDetails.host} not found. Please check the hostname.`);
    } else if (error.message.includes('Authentication failed')) {
      throw new Error('Authentication failed. Please check username and password.');
    } else {
      throw error;
    }
  }
}

async function testDatabaseConnection(connectionDetails) {
  try {
    let isSecure = false;
    let warning = null;
    let message = '';

    // For external connections, validate database name match
    if (connectionDetails.server_type === 'external' && connectionDetails.connection_string) {
      const dbValidation = validateDatabaseName(
        connectionDetails.connection_string, 
        connectionDetails.database, 
        connectionDetails.type
      );
      
      if (!dbValidation.valid) {
        throw new Error(dbValidation.message);
      }

      // Use the actual database name from connection string if validation passed
      const actualDatabase = dbValidation.actualDatabase;

      switch (connectionDetails.type) {
        case 'PostgreSQL':
        case 'MySQL': {
          const sequelize = new Sequelize(connectionDetails.connection_string, {
            logging: false,
            dialectOptions: {
              connectTimeout: 5000,
              ssl: connectionDetails.ssl ? {
                require: true,
                rejectUnauthorized: false
              } : false
            }
          });

          await sequelize.authenticate();
          
          // Verify the actual database exists and is accessible - with better error handling
          try {
            if (connectionDetails.type === 'MySQL') {
              // For MySQL, check current database
              const [result] = await sequelize.query('SELECT DATABASE() as current_db');
              const currentDb = result[0]?.current_db;
              if (currentDb && currentDb !== actualDatabase) {
                console.warn(`Connected to database '${currentDb}' but expected '${actualDatabase}'`);
                // Don't throw error, just warn - connection is still successful
              }
            } else {
              // For PostgreSQL, check current database using PostgreSQL-specific query
              const [result] = await sequelize.query('SELECT current_database() as current_db');
              const currentDb = result[0]?.current_db;
              if (currentDb && currentDb !== actualDatabase) {
                console.warn(`Connected to database '${currentDb}' but expected '${actualDatabase}'`);
              }
            }
          } catch (dbError) {
            console.warn('Database verification query failed, but connection is successful:', dbError.message);
          }
          
          await sequelize.close();
          isSecure = connectionDetails.ssl;
          message = `Connection successful to external ${connectionDetails.type} database`;
          break;
        }
        case 'ClickHouse': {
          let client;
          let config = {};
          
          // Parse connection string and validate
          if (connectionDetails.connection_string.includes('://')) {
            config.url = connectionDetails.connection_string;
          } else {
            config.url = `http://${connectionDetails.connection_string}:8123/${actualDatabase}`;
          }
          
          config.request_timeout = 5000;
          
          client = await createClickHouseClient(config, connectionDetails);

          // Verify we're connected to the correct database
          const dbCheck = await client.query({
            query: `SELECT name, currentDatabase() as current_db FROM system.databases WHERE name = '${actualDatabase}'`,
            format: 'JSONEachRow'
          });
          
          const databases = await dbCheck.json();
          if (databases.length === 0) {
            throw new Error(`Database '${actualDatabase}' does not exist`);
          }

          isSecure = connectionDetails.connection_string.startsWith('https://');
          message = `Connection successful to ClickHouse database '${actualDatabase}'`;
          break;
        }
        case 'MongoDB': {
          throw new Error('MongoDB connections are temporarily disabled');
        }
        default:
          throw new Error('Unsupported database type for external connection');
      }
    } else {
      switch (connectionDetails.type) {
        case 'PostgreSQL':
        case 'MySQL': {
          const password = connectionDetails.password === '' ? undefined : connectionDetails.password;

          const sequelize = new Sequelize({
            dialect: connectionDetails.type.toLowerCase(),
            host: connectionDetails.host,
            port: connectionDetails.port,
            username: connectionDetails.username,
            password: password,
            database: connectionDetails.database,
            logging: false,
            dialectOptions: {
              connectTimeout: 5000,
              ssl: connectionDetails.ssl ? {
                require: true,
                rejectUnauthorized: false
              } : false
            }
          });

          await sequelize.authenticate();
          await sequelize.close();

          // Check for default credentials warning
          if (connectionDetails.type === 'PostgreSQL' &&
            connectionDetails.port === '5432' &&
            connectionDetails.host === 'localhost' &&
            connectionDetails.username === 'postgres') {
            warning = 'Warning: Using default PostgreSQL credentials. Consider changing for security.';
          }

          // Check if this is a cloud database being added as local
          if (isCloudDatabase(connectionDetails.host, connectionDetails.type)) {
            throw new Error(`Cloud databases should be added as external connections. Detected cloud host: ${connectionDetails.host}`);
          }

          isSecure = connectionDetails.ssl || !warning;
          message = warning || 'Connection successful';
          break;
        }
        case 'ClickHouse': {
          const password = connectionDetails.password === '' ? undefined : connectionDetails.password;
          
          // Check if this is a cloud database being added as local
          if (isCloudDatabase(connectionDetails.host, connectionDetails.type)) {
            throw new Error(`Cloud databases should be added as external connections. Detected cloud host: ${connectionDetails.host}`);
          }

          const protocol = connectionDetails.ssl ? 'https' : 'http';
          const port = connectionDetails.port || 8123;
          const database = connectionDetails.database || 'default';
          
          const host = connectionDetails.host === 'localhost' ? '127.0.0.1' : connectionDetails.host;
          
          let url;
          if (connectionDetails.username && password) {
            url = `${protocol}://${connectionDetails.username}:${password}@${host}:${port}/${database}`;
          } else if (connectionDetails.username) {
            url = `${protocol}://${connectionDetails.username}@${host}:${port}/${database}`;
          } else {
            url = `${protocol}://${host}:${port}/${database}`;
          }

          const client = await createClickHouseClient({
            url: url,
            request_timeout: 10000,
          }, connectionDetails);

          // Check if database exists by querying system.databases
          const dbCheck = await client.query({
            query: `SELECT name FROM system.databases WHERE name = '${database}'`,
            format: 'JSONEachRow'
          });
          
          const databases = await dbCheck.json();
          if (databases.length === 0) {
            throw new Error(`Database '${database}' does not exist`);
          }

          isSecure = connectionDetails.ssl;
          message = `Connection successful to ClickHouse database '${database}'`;
          break;
        }
        case 'MongoDB': {
          throw new Error('MongoDB connections are temporarily disabled');
        }
        default:
          throw new Error('Unsupported database type');
      }
    }

    return {
      success: true,
      message,
      warning,
      isSecure
    };
  } catch (error) {
    console.error(`Connection test failed for ${connectionDetails.type}:`, error);

    let errorMessage = 'Connection failed';
    if (error.original) {
      // PostgreSQL/MySQL specific errors
      switch (error.original.code) {
        case 'ECONNREFUSED':
          errorMessage = 'Connection refused. Check if host and port are correct and server is running.';
          break;
        case 'ENOTFOUND':
          errorMessage = 'Host not found. Check the hostname or IP address.';
          break;
        case 'ETIMEDOUT':
          errorMessage = 'Connection timed out. Check network connectivity.';
          break;
        case '3D000': // PostgreSQL invalid database
          errorMessage = `Database '${connectionDetails.database}' does not exist.`;
          break;
        case '28P01': // PostgreSQL invalid password
          errorMessage = 'Authentication failed: Invalid username or password.';
          break;
        default:
          if (error.original.message.includes('password authentication failed')) {
            errorMessage = 'Authentication failed: Invalid username or password.';
          } else if (error.original.message.includes('database')) {
            errorMessage = `Database '${connectionDetails.database}' does not exist.`;
          } else {
            errorMessage = error.original.message;
          }
      }
    } else if (error.message) {
      // ClickHouse and MongoDB specific errors
      if (error.message.includes('Authentication failed') || 
          error.message.includes('password is incorrect') ||
          error.message.includes('Wrong credentials') ||
          error.message.includes('401') ||
          error.message.includes('403')) {
        errorMessage = 'Authentication failed: Invalid username or password.';
      } else if (error.message.includes('getaddrinfo ENOTFOUND') || error.message.includes('ENOTFOUND')) {
        errorMessage = 'Host not found. Check the hostname or IP address.';
      } else if (error.message.includes('connection timed out') || errorMessage.includes('timeout')) {
        errorMessage = 'Connection timed out. Check network connectivity.';
      } else if (error.message.includes('MongoDB connections are temporarily disabled')) {
        errorMessage = 'MongoDB connections are temporarily disabled.';
      } else if (error.message.includes('ClickHouse URL is malformed')) {
        errorMessage = 'Invalid ClickHouse connection format. For external connections, use full URL format: http[s]://[username:password@]hostname:port[/database]';
      } else if (error.message.includes('does not exist')) {
        errorMessage = error.message;
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = error.message;
      } else if (error.message.includes('Cloud databases should be added as external connections')) {
        errorMessage = error.message;
      } else if (error.message.includes('Database name mismatch')) {
        errorMessage = error.message;
      } else if (error.message.includes('Connected to database')) {
        errorMessage = error.message;
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      message: `${connectionDetails.type} connection failed: ${errorMessage}`
    };
  }
}

module.exports = {
  getAllDatabases: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      const { count, rows } = await DatabaseConnection.findAndCountAll({
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['created_at', 'DESC']],
        attributes: { include: ['password'] } // Always exclude password // included the password for fastapi connections
      });



      res.json({
        success: true,
        databases: rows,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page)
      });
    } catch (error) {
      console.error('Error fetching databases:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch databases',
        error: error.message
      });
    }
  },

  addDatabase: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const {
        name,
        server_type,
        type,
        host,
        port,
        username,
        password,
        database,
        connection_string,
        ssl = false
      } = req.body;

      // Disable MongoDB connections
      if (type === 'MongoDB') {
        return res.status(400).json({
          success: false,
          message: 'MongoDB connections are temporarily disabled'
        });
      }

      if (server_type === 'local') {
        if (!host || !port || !username || password === undefined) {
          return res.status(400).json({
            success: false,
            message: 'Host, port, username, and password are required for local connections'
          });
        }

        // Check if this is a cloud database being added as local
        if (isCloudDatabase(host, type)) {
          return res.status(400).json({
            success: false,
            message: `Cloud databases should be added as external connections. Detected cloud host: ${host}`
          });
        }
      } else if (server_type === 'external') {
        if (!connection_string) {
          return res.status(400).json({
            success: false,
            message: 'Connection string is required for external connections'
          });
        }

        // Validate database name for external connections
        const dbValidation = validateDatabaseName(connection_string, database, type);
        if (!dbValidation.valid) {
          return res.status(400).json({
            success: false,
            message: dbValidation.message
          });
        }
      }

      const existingName = await DatabaseConnection.findOne({ where: { name } });
      if (existingName) {
        return res.status(400).json({
          success: false,
          message: 'Database connection with this name already exists'
        });
      }

      // Check for duplicate databases across both local and external types
      const newConnectionData = {
        server_type,
        type,
        host,
        port,
        database,
        connection_string
      };

      // Get all existing connections to check for duplicates
      const allConnections = await DatabaseConnection.findAll();

      for (const existingConn of allConnections) {
        if (isSameDatabase(newConnectionData, existingConn)) {
          return res.status(400).json({
            success: false,
            message: 'This database connection already exists (same database detected across different connection types)'
          });
        }
      }

      if (server_type === 'local') {
        const existingConnection = await DatabaseConnection.findOne({
          where: {
            host,
            port,
            type,
            database,
            server_type: 'local'
          }
        });

        if (existingConnection) {
          return res.status(400).json({
            success: false,
            message: 'A connection to this database already exists'
          });
        }
      } else {
        const existingConnection = await DatabaseConnection.findOne({
          where: {
            connection_string,
            server_type: 'external'
          }
        });

        if (existingConnection) {
          return res.status(400).json({
            success: false,
            message: 'This external connection already exists'
          });
        }
      }

      const testResult = await testDatabaseConnection({
        server_type,
        type,
        host,
        port,
        username,
        password,
        database,
        connection_string,
        ssl
      });

      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          message: testResult.message,
          status: 'Disconnected'
        });
      }

      const status = testResult.isSecure ? 'Connected' :
        testResult.warning ? 'Connected (Warning)' : 'Connected';

      const newConnection = await DatabaseConnection.create({
        name,
        server_type,
        type,
        host: server_type === 'local' ? host : null,
        port: server_type === 'local' ? port : null,
        username: server_type === 'local' ? username : null,
        password: server_type === 'local' ? password : null,
        database,
        connection_string: server_type === 'external' ? connection_string : null,
        ssl,
        status
      });

      const responseData = newConnection.get({ plain: true });
      delete responseData.password;

      res.status(201).json({
        success: true,
        message: testResult.warning ? testResult.warning : 'Database connection added successfully',
        database: responseData
      });
    } catch (error) {
      console.error('Error adding database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add database connection',
        error: error.message
      });
    }
  },

  testDatabase: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const connection = await DatabaseConnection.findByPk(id);

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      // Disable MongoDB testing
      if (connection.type === 'MongoDB') {
        return res.status(400).json({
          success: false,
          message: 'MongoDB connections are temporarily disabled'
        });
      }

      await connection.update({ status: 'Testing...' });

      // Get the actual password from database for testing
      const connectionWithPassword = await DatabaseConnection.findByPk(id, {
        attributes: { include: ['password'] } // Include password for testing
      });

      const testResult = await testDatabaseConnection(connectionWithPassword);

      if (testResult.success) {
        const status = testResult.isSecure ? 'Connected' :
          testResult.warning ? 'Connected (Warning)' : 'Connected';

        await connection.update({ status });
        return res.json({
          success: true,
          message: testResult.warning ? testResult.warning : testResult.message,
          status
        });
      }

      await connection.update({ status: 'Disconnected' });
      return res.status(400).json({
        success: false,
        message: testResult.message,
        status: 'Disconnected'
      });
    } catch (error) {
      console.error('Error testing database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test database connection',
        error: error.message
      });
    }
  },

  connectDatabase: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const connection = await DatabaseConnection.findByPk(id);

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      // Disable MongoDB connections
      if (connection.type === 'MongoDB') {
        return res.status(400).json({
          success: false,
          message: 'MongoDB connections are temporarily disabled'
        });
      }

      await connection.update({ status: 'Connecting...' });

      // Get the actual password from database for testing
      const connectionWithPassword = await DatabaseConnection.findByPk(id, {
        attributes: { include: ['password'] } // Include password for testing
      });

      const testResult = await testDatabaseConnection(connectionWithPassword);

      if (testResult.success) {
        const status = testResult.isSecure ? 'Connected' :
          testResult.warning ? 'Connected (Warning)' : 'Connected';

        await connection.update({ status });

        console.log(testResult)
        return res.json({
          success: true,
          message: testResult.warning ? testResult.warning : 'Database connected successfully',
          status,
          databasedetails: connectionWithPassword.get()
        });
      }

      await connection.update({ status: 'Disconnected' });
      return res.status(400).json({
        success: false,
        message: testResult.message,
        status: 'Disconnected'
      });
    } catch (error) {
      console.error('Error connecting to database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to connect to database',
        error: error.message
      });
    }
  },

  disconnectDatabase: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const connection = await DatabaseConnection.findByPk(id);

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      await connection.update({ status: 'Disconnecting...' });
      await new Promise(resolve => setTimeout(resolve, 1000));
      await connection.update({ status: 'Disconnected' });

      return res.json({
        success: true,
        message: 'Database disconnected successfully',
        status: 'Disconnected'
      });
    } catch (error) {
      console.error('Error disconnecting from database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to disconnect from database',
        error: error.message
      });
    }
  },

  getDatabaseDetails: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const connection = await DatabaseConnection.findByPk(id);

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      const responseData = connection.get({ plain: true });
      // Return connection string for external connections
      if (responseData.server_type === 'external') {
        responseData.connection_string = responseData.connection_string;
      } else {
        responseData.password = ''; // Never return the actual password (for security reasons)
      }

      res.json({
        success: true,
        database: responseData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get database details',
        error: error.message
      });
    }
  },

  getDatabaseSchema: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const connection = await DatabaseConnection.findByPk(id, {
        attributes: { include: ['password'] }
      });

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      // Disable MongoDB schema fetching
      if (connection.type === 'MongoDB') {
        return res.status(400).json({
          success: false,
          message: 'MongoDB connections are temporarily disabled'
        });
      }

      let tables = [];
      let collections = [];

      if (connection.status !== 'Connected' && connection.status !== 'Connected (Warning)') {
        return res.status(400).json({
          success: false,
          message: 'Database is not connected. Please connect first to view schema.'
        });
      }

      if (connection.type === 'PostgreSQL' || connection.type === 'MySQL') {
        let sequelizeConfig;

        if (connection.server_type === 'local') {
          const password = connection.password === '' ? undefined : connection.password;
          sequelizeConfig = {
            dialect: connection.type.toLowerCase(),
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: password,
            database: connection.database,
            logging: false,
            dialectOptions: {
              ssl: connection.ssl ? {
                require: true,
                rejectUnauthorized: false
              } : false
            }
          };
        } else {
          sequelizeConfig = {
            dialect: connection.type.toLowerCase(),
            logging: false,
            dialectOptions: {
              ssl: connection.ssl ? {
                require: true,
                rejectUnauthorized: false
              } : false,
              connectTimeout: 10000 // Increase timeout for external connections
            }
          };
        }

        const tempSequelize = connection.server_type === 'external' ?
          new Sequelize(connection.connection_string, sequelizeConfig) :
          new Sequelize(sequelizeConfig);

        try {
          await tempSequelize.authenticate();

          // Extract database name from connection for MySQL queries
          let actualDatabase = connection.database;
          if (connection.server_type === 'external' && connection.type === 'MySQL') {
            // For external MySQL connections, extract database name from connection string if not provided
            if (!actualDatabase) {
              const dbMatch = connection.connection_string.match(/\/([^?]+)/);
              if (dbMatch && dbMatch[1]) {
                actualDatabase = dbMatch[1];
              } else {
                actualDatabase = 'supermarket'; // fallback to default
              }
            }
          }

          if (connection.type === 'PostgreSQL') {
            const query = `
              SELECT table_name 
              FROM information_schema.tables 
              WHERE table_schema = 'public' 
              AND table_type = 'BASE TABLE'
              ORDER BY table_name;
            `;
            const result = await tempSequelize.query(query, { type: Sequelize.QueryTypes.SELECT });
            tables = result
              .map(row => row.table_name || row.TABLE_NAME)
              .filter(name => typeof name === 'string' && name.length > 0);
          } else if (connection.type === 'MySQL') {
            const query = `
              SELECT table_name 
              FROM information_schema.tables 
              WHERE table_schema = ?
              ORDER BY table_name;
            `;
            const result = await tempSequelize.query(query, {
              replacements: [actualDatabase],
              type: Sequelize.QueryTypes.SELECT
            });
            tables = result
              .map(row => row.table_name || row.TABLE_NAME)
              .filter(name => typeof name === 'string' && name.length > 0);
          }

          await tempSequelize.close();
        } catch (error) {
          console.error('Error fetching schema:', error);
          await tempSequelize.close();
          throw error;
        }
      } else if (connection.type === 'ClickHouse') {
        let client;
        try {
          if (connection.server_type === 'local') {
            const password = connection.password === '' ? undefined : connection.password;
            const protocol = connection.ssl ? 'https' : 'http';
            const port = connection.port || 8123;
            const database = connection.database || 'default';
            
            const host = connection.host === 'localhost' ? '127.0.0.1' : connection.host;
            
            let url;
            if (connection.username && password) {
              url = `${protocol}://${connection.username}:${password}@${host}:${port}/${database}`;
            } else if (connection.username) {
              url = `${protocol}://${connection.username}@${host}:${port}/${database}`;
            } else {
              url = `${protocol}://${host}:${port}/${database}`;
            }

            client = await createClickHouseClient({
              url: url,
              request_timeout: 10000
            }, connection);
          } else {
            // For external connections
            let url = connection.connection_string;
            // If it's just a hostname, construct proper URL
            if (!connection.connection_string.includes('://')) {
              url = `http://${connection.connection_string}:8123/default`;
            }
            
            client = await createClickHouseClient({
              url: url,
              request_timeout: 10000
            }, connection);
          }

          // Get tables from ClickHouse
          const dbName = connection.database || 'default';
          const result = await client.query({
            query: `SELECT name FROM system.tables WHERE database = '${dbName}'`,
            format: 'JSONEachRow'
          });

          const rows = await result.json();
          tables = rows.map(row => row.name).filter(name => typeof name === 'string' && name.length > 0);
          
        } catch (error) {
          throw error;
        }
      }

      res.json({
        success: true,
        tables,
        collections,
        databaseType: connection.type
      });
    } catch (error) {
      console.error('Error in getDatabaseSchema:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch database schema',
        error: error.message
      });
    }
  },

  getTableData: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id, tableName } = req.params;

      if (!tableName || tableName === 'null' || tableName === 'undefined') {
        return res.status(400).json({
          success: false,
          message: 'Invalid table name'
        });
      }

      const connection = await DatabaseConnection.findByPk(id, {
        attributes: { include: ['password'] }
      });

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      // Disable MongoDB data fetching
      if (connection.type === 'MongoDB') {
        return res.status(400).json({
          success: false,
          message: 'MongoDB connections are temporarily disabled'
        });
      }

      if (connection.status !== 'Connected' && connection.status !== 'Connected (Warning)') {
        return res.status(400).json({
          success: false,
          message: 'Database is not connected. Please connect first to view data.'
        });
      }

      let data = [];

      if (connection.type === 'PostgreSQL' || connection.type === 'MySQL') {
        let sequelizeConfig;

        if (connection.server_type === 'local') {
          const password = connection.password === '' ? undefined : connection.password;
          sequelizeConfig = {
            dialect: connection.type.toLowerCase(),
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: password,
            database: connection.database,
            logging: false,
            dialectOptions: {
              ssl: connection.ssl ? {
                require: true,
                rejectUnauthorized: false
              } : false
            }
          };
        } else {
          sequelizeConfig = {
            dialect: connection.type.toLowerCase(),
            logging: false,
            dialectOptions: {
              ssl: connection.ssl ? {
                require: true,
                rejectUnauthorized: false
              } : false,
              connectTimeout: 10000 // Increase timeout for external connections
            }
          };
        }

        const tempSequelize = connection.server_type === 'external' ?
          new Sequelize(connection.connection_string, sequelizeConfig) :
          new Sequelize(sequelizeConfig);

        try {
          await tempSequelize.authenticate();

          let query;
          if (connection.type === 'MySQL') {
            query = `SELECT * FROM \`${tableName}\` LIMIT 50`;
          } else {
            query = `SELECT * FROM "${tableName}" LIMIT 50`;
          }
          const result = await tempSequelize.query(query, {
            type: Sequelize.QueryTypes.SELECT
          });

          data = result;
          await tempSequelize.close();
        } catch (error) {
          console.error('Error fetching table data:', error);
          await tempSequelize.close();
          throw error;
        }
      } else if (connection.type === 'ClickHouse') {
        let client;
        try {
          if (connection.server_type === 'local') {
            const password = connection.password === '' ? undefined : connection.password;
            const protocol = connection.ssl ? 'https' : 'http';
            const port = connection.port || 8123;
            const database = connection.database || 'default';
            
            const host = connection.host === 'localhost' ? '127.0.0.1' : connection.host;
            
            let url;
            if (connection.username && password) {
              url = `${protocol}://${connection.username}:${password}@${host}:${port}/${database}`;
            } else if (connection.username) {
              url = `${protocol}://${connection.username}@${host}:${port}/${database}`;
            } else {
              url = `${protocol}://${host}:${port}/${database}`;
            }

            client = await createClickHouseClient({
              url: url,
              request_timeout: 10000
            }, connection);
          } else {
            // For external connections
            let url = connection.connection_string;
            // If it's just a hostname, construct proper URL
            if (!connection.connection_string.includes('://')) {
              url = `http://${connection.connection_string}:8123/default`;
            }
            
            client = await createClickHouseClient({
              url: url,
              request_timeout: 10000
            }, connection);
          }

          const result = await client.query({
            query: `SELECT * FROM ${tableName} LIMIT 50`,
            format: 'JSONEachRow'
          });

          data = await result.json();
          
        } catch (error) {
          throw error;
        }
      }

      res.json({
        success: true,
        data: data,
        message: 'Data fetched successfully'
      });
    } catch (error) {
      console.error('Error in getTableData:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch table data',
        error: error.message
      });
    }
  },

  updateDatabase: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const {
        name,
        server_type,
        type,
        host,
        port,
        username,
        password,
        database,
        connection_string,
        ssl = false
      } = req.body;

      // Disable MongoDB updates
      if (type === 'MongoDB') {
        return res.status(400).json({
          success: false,
          message: 'MongoDB connections are temporarily disabled'
        });
      }

      const connection = await DatabaseConnection.findByPk(id, {
        attributes: { include: ['password'] } // Include password for testing
      });
      
      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      // Check if name is being changed and if new name already exists
      if (name && name !== connection.name) {
        const existingName = await DatabaseConnection.findOne({
          where: { name },
          attributes: ['id']
        });

        if (existingName && existingName.id !== parseInt(id)) {
          return res.status(400).json({
            success: false,
            message: 'Database connection with this name already exists'
          });
        }
      }

      // Check for cloud database validation when updating to local type
      if (server_type === 'local' && isCloudDatabase(host, type)) {
        return res.status(400).json({
          success: false,
            message: `Cloud databases should be added as external connections. Detected cloud host: ${host}`
        });
      }

      // For external connections, validate database name match
      if (server_type === 'external' && connection_string) {
        const dbValidation = validateDatabaseName(connection_string, database, type);
        if (!dbValidation.valid) {
          return res.status(400).json({
            success: false,
            message: dbValidation.message
          });
        }
      }

      // Check for duplicate databases across both local and external types
      const updatedConnectionData = {
        server_type,
        type,
        host,
        port,
        database,
        connection_string
      };

      // Get all existing connections to check for duplicates
      const allConnections = await DatabaseConnection.findAll({
        where: {
          id: { [Sequelize.Op.not]: id }
        }
      });

      for (const existingConn of allConnections) {
        if (isSameDatabase(updatedConnectionData, existingConn)) {
          return res.status(400).json({
            success: false,
            message: 'This database connection already exists (same database detected across different connection types)'
          });
        }
      }

      // For local connections, check if host/port/type/database combination exists
      if (server_type === 'local') {
        const existingConnection = await DatabaseConnection.findOne({
          where: {
            host,
            port,
            type,
            database,
            server_type: 'local',
            id: { [Sequelize.Op.not]: id } // Exclude current connection
          }
        });

        if (existingConnection) {
          return res.status(400).json({
            success: false,
            message: 'A connection to this database already exists'
          });
        }
      } else {
        // For external connections, check if connection string exists
        const existingConnection = await DatabaseConnection.findOne({
          where: {
            connection_string,
            server_type: 'external',
            id: { [Sequelize.Op.not]: id } // Exclude current connection
          }
        });

        if (existingConnection) {
          return res.status(400).json({
            success: false,
            message: 'This external connection already exists'
          });
        }
      }
      
      const passwordToTest = password !== undefined ? password : connection.password;

      // Test the connection before updating
      const testResult = await testDatabaseConnection({
        server_type,
        type,
        host,
        port,
        username,
        password: passwordToTest,
        database,
        connection_string,
        ssl
      });

      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          message: testResult.message,
          status: 'Disconnected'
        });
      }

      const status = testResult.isSecure ? 'Connected' :
        testResult.warning ? 'Connected (Warning)' : 'Connected';

      const updateData = {
        name,
        server_type,
        type,
        database,
        ssl,
        status
      };

      if (server_type === 'local') {
        updateData.host = host;
        updateData.port = port;
        updateData.username = username;
        if (password !== undefined) {
          updateData.password = password;
        }
        updateData.connection_string = null;
      } else {
        updateData.host = null;
        updateData.port = null;
        updateData.username = null;
        updateData.password = null;
        updateData.connection_string = connection_string;
      }

      await connection.update(updateData);

      const responseData = connection.get({ plain: true });
      delete responseData.password;

      res.json({
        success: true,
        message: testResult.warning ? testResult.warning : 'Database connection updated successfully',
        database: responseData
      });
    } catch (error) {
      console.error('Error updating database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update database connection',
        error: error.message
      });
    }
  },

  deleteDatabase: async (req, res) => {
    try {
      // Check if user exists and token is not revoked
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if user token is revoked
      if (usersController.isTokenRevoked(req.user.id.toString())) {
        return res.status(401).json({
          success: false,
          message: 'Token revoked. User account no longer exists.'
        });
      }

      const { id } = req.params;
      const connection = await DatabaseConnection.findByPk(id);

      if (!connection) {
        return res.status(404).json({
          success: false,
          message: 'Database connection not found'
        });
      }

      await connection.destroy();

      return res.json({
        success: true,
        message: 'Database connection deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting database:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete database connection',
        error: error.message
      });
    }
  }
};