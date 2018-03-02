// Import the mongoose module
const mongoose = require('mongoose');

const { Schema } = mongoose;

// A schema for users. Basic users have just a username, while Google Plus
// Users also have a Google Id
const userSchema = new Schema({
  local: {
    username: String,
  },
  google: {
    username: String,
    googleId: String,
  },
});

// Construct a user model using mongoose
const User = mongoose.model('user', userSchema);

// Export the user model
module.exports = User;
