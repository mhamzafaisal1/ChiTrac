// config/passport.js

// load all the things we need
var LocalStrategy = require('passport-local').Strategy;

// load up the user model
//const User = require('/models/user');
//var UserGroups = require('../app/models/userGroups')

const bcrypt = require('bcryptjs');
const ObjectId = require('mongodb').ObjectId;

// expose this function to our app using module.exports
module.exports = function(passport, server) {
    const db = server.db;
    const userCollection = db.collection('user');

    // =========================================================================
    // passport session setup ==================================================
    // =========================================================================
    // required for persistent login sessions
    // passport needs ability to serialize and unserialize users out of session

    // used to serialize the user for the session
    passport.serializeUser(function(user, callback) {
        callback(null, user['_id']);
    });

    // used to deserialize the user
    passport.deserializeUser(async function(id, callback) {
        try {
			const userFind = await userCollection.find({ '_id': new ObjectId(id) }).toArray();
            if (userFind.length) {
                return callback(null, userFind[0]);
            } else {
                throw ({ error: 'no user found' });
            }
        } catch (error) {
            return callback(error);
        }
    });

    // =========================================================================
    // LOCAL SIGNUP ============================================================
    // =========================================================================
    // we are using named strategies since we have one for login and one for signup
    // by default, if there was no name, it would just be called 'local'

    passport.use('local-signup', new LocalStrategy({
        // by default, local strategy uses username and password, we will override with email
        usernameField: 'username',
        passwordField: 'password',
        passReqToCallback: true // allows us to pass back the entire request to the callback
    }, function(req, username, password, callback) {

        // asynchronous
        // User.findOne wont fire unless data is sent back
        process.nextTick(async function() {
            try {
                const userFind = await userCollection.find({ 'local.username': username }).toArray();
                if (userFind.length) {
                    return callback(null, false, req.flash('messages', 'That username is already taken.'));
                } else {

                    // if there is no user with that email
                    // create the user
                    let newUser = {
                        local: {
                            username: null,
                            password: null,
                        }
                    };

                    // set the user's local credentials
                    newUser.local.username = username;

					const salt = bcrypt.genSaltSync(10);
					const hash = bcrypt.hashSync(password, salt);
					newUser.local.password = hash;
                    if (req.body.email) {
                        newUser.email = req.body.email
                    }
                    if (req.body.role) {
                        newUser.role = req.body.role
                    }
                    if (req.body.groups) {
                        newUser.groups = req.body.groups
                    }
                    if (req.body.restrictions) {
                        newUser.restrictions = req.body.restrictions
                    }

                    // save the user
                    try {
						const newUserInsert = await userCollection.insertOne(newUser);
						return callback(null, newUser);
                    } catch (error) {
                    	return callback(error)
                    }

                }
            } catch (error) {
                return callback(error);
            }


        });

    }));

    // =========================================================================
    // LOCAL LOGIN =============================================================
    // =========================================================================
    // we are using named strategies since we have one for login and one for signup
    // by default, if there was no name, it would just be called 'local'

    passport.use('local-login', new LocalStrategy({
        // by default, local strategy uses username and password, we will override with email
        usernameField: 'username',
        passwordField: 'password',
        passReqToCallback: true // allows us to pass back the entire request to the callback
    }, async function(req, username, password, callback) { // callback with email and password from our form

        try {
            const userFind = await userCollection.find({ 'local.username': username }).toArray();
            if (userFind.length) {
                const user = userFind[0]
				if (!bcrypt.compareSync(password, user.local.password)) {
                    return callback(null, false, req.flash('messages', 'Oops! Wrong password.'));
                } else {
                    return callback(null, user);
                }
            } else {
                return callback(null, false, req.flash('messages', 'No user found.'));
            }
        } catch (error) {
            return callback(error);
        }

    }));

};