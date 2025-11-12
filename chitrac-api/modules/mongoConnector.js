module.exports = function(config) {
	return constructor(config);
}

function constructor(config) {
	/** Load MongoDB */
	const { MongoClient } = require('mongodb');
	
	// Parse the URL to extract host and database
	const url = config.mongo.url;
	const username = config.mongo.username;
	const password = config.mongo.password;
	const authSource = config.mongo.authSource || 'admin';
	
	// Build authenticated connection string
	// Expected format: mongodb://host:port/database
	// New format: mongodb://username:password@host:port/database?authSource=admin
	let authUrl;
	
	// URL encode username and password (especially important for special characters)
	const encodedUsername = encodeURIComponent(username);
	const encodedPassword = encodeURIComponent(password);
	
	if (url.startsWith('mongodb://')) {
		// Extract the part after mongodb://
		const urlWithoutScheme = url.substring(10); // Remove 'mongodb://'
		
		// Insert credentials into the connection string with authSource
		// Format: mongodb://username:password@host:port/database?authSource=admin
		authUrl = `mongodb://${encodedUsername}:${encodedPassword}@${urlWithoutScheme}?directConnection=true&authSource=admin`;
		//authUrl = `mongodb://localhost:27017/chitrac`;
		console.log('MongoDB connection string:', authUrl.replace(/:[^:@]+@/, ':****@')); // Log without password
	} else {
		// If format is unexpected, just append credentials before @
		authUrl = url.replace('mongodb://', `mongodb://${encodedUsername}:${encodedPassword}@`);
		// Add authSource if URL doesn't already have query params
		if (!authUrl.includes('?')) {
			authUrl += `?authSource=${authSource}`;
		} else {
			authUrl += `&authSource=${authSource}`;
		}
	}
	
	const dbClient = new MongoClient(authUrl);
	const db = dbClient.db(config.mongo.db);

	return db;
}

