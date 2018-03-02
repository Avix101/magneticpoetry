// Import the mongoose module
const mongoose = require('mongoose');

const { Schema } = mongoose;

// A schema for boards. All boards have a name, an official Google Plus owner, and a
// state object (board) that holds all word related information
const boardSchema = new Schema({
  name: String,
  owner: String,
  board: Object,
});

// Create a board model
const Board = mongoose.model('board', boardSchema);

// Export the board model
module.exports = Board;
