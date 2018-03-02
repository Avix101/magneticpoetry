// Import the necessary authentication modules
const passport = require('passport');
const LocalStrategy = require('passport-local');
const GoogleStrategy = require('passport-google-oauth20');
const User = require('./user-model.js');

// Configure passport when this init function is called
const init = () => {
  // When a user logs in, they are serialized (user id stored for future calls)
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // When a user goes to a page, their info will be checked against what is stored on the server
  passport.deserializeUser((id, done) => {
    User.findById(id).then((user) => {
      done(null, user);
    });
  });

  // This defines a local authentication strategy- the guest login method
  passport.use('guest-login', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'username',
    passReqToCallback: true,
  }, (req, username, password, done) => {
    // We need a username!
    if (!req.body.username) {
      done('invalid username parameter.');
    }

    // Check to see if the user exists first
    User.findOne({
      'local.username': req.body.username,
    }).then((existingUser) => {
      // We're done if the user already exists
      if (existingUser) {
        done(null, existingUser);
      } else {
        // Otherwise, we need to create a new local user
        new User({
          'local.username': username,
        }).save().then((newUser) => {
          done(null, newUser);
        });
      }
    });
  }));

  // This defines a Google login strategy for passport
  passport.use(new GoogleStrategy({
    // Parameters for Google Strategy
    callbackURL: '/authenticated',
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_SECRET_KEY,
  }, (accessToken, refreshToken, profile, done) => {
    // Passport callback

    // Check to see if we can find the user first, otherwise create a new user
    // Utilizes Promises to handle asynchronous database (MongoDB) lookup
    User.findOne({
      'google.googleId': profile.id,
    }).then((existingUser) => {
      if (existingUser) {
        done(null, existingUser);
      } else {
        new User({
          'google.username': profile.displayName,
          'google.googleId': profile.id,
        }).save().then((newUser) => {
          done(null, newUser);
        });
      }
    });
  }));
};

// Export the public facing init function
module.exports = { init };
