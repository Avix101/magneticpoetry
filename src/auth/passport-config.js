const passport = require('passport');
const LocalStrategy = require('passport-local');
const GoogleStrategy = require('passport-google-oauth20');
const User = require('./user-model.js');

const init = () => {
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    User.findById(id).then((user) => {
      done(null, user);
    });
  });

  passport.use('guest-login', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'username',
    passReqToCallback: true,
  }, (req, username, password, done) => {
    if (!req.body.username) {
      done('invalid username parameter.');
    }

    User.findOne({
      'local.username': req.body.username,
    }).then((existingUser) => {
      if (existingUser) {
        done(null, existingUser);
      } else {
        new User({
          'local.username': username,
        }).save().then((newUser) => {
          done(null, newUser);
        });
      }
    });
  }));

  passport.use(new GoogleStrategy({
    // Parameters for Google Strategy
    callbackURL: '/authenticated',
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_SECRET_KEY,
  }, (accessToken, refreshToken, profile, done) => {
    // Passport callback

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

module.exports = { init };

// Login using Google to create or join poetry boards, and always have access to your contributions
// Creators of poetry boards should have some kind of admin access?
// Login as a guest with a username to join a poetry board.
// Once your session expires you will not be able to edit your changes,
// as you are a temporary user

