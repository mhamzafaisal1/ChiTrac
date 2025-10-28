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
	
	// Build authenticated connection string
	// Expected format: mongodb://host:port/database
	// New format: mongodb://username:password@host:port/database
	let authUrl;
	if (url.startsWith('mongodb://')) {
		// Extract the part after mongodb://
		const urlWithoutScheme = url.substring(10); // Remove 'mongodb://'
		const slashIndex = urlWithoutScheme.indexOf('/');
		
		/*if (slashIndex === -1) {
			// No database specified in URL, append it
			authUrl = `mongodb://${username}:${password}@${urlWithoutScheme}/${config.mongo.db}`;
		} else {
			// Database specified in URL
			authUrl = `mongodb://${username}:${password}@${urlWithoutScheme}`;
		}*/
		authUrl = url + '';
		console.log(authUrl);
	} else {
		// If format is unexpected, just append credentials before @
		authUrl = url.replace('mongodb://', `mongodb://${username}:${password}@`);
	}
	
	const dbClient = new MongoClient(authUrl);
	const db = dbClient.db(config.mongo.db);

	return db;
}

