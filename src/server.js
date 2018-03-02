// Import modules
const http = require('http');
const url = require('url');
const query = require('querystring');
const express = require('express');

const app = express();
const bodyParser = require('body-parser');
const stream = require('stream');

// Custom board model module
const Board = require('./board-model.js');

// Set up cookie session
const cookieSession = require('cookie-session');

const cookieS = cookieSession({
// Age of cookie = 4 hours
  maxAge: 4 * 60 * 60 * 1000,
  keys: [process.env.COOKIE_SECRET],
});

// Really helpful passport tut: https://www.youtube.com/watch?v=5VHBy2PjxKs (entire playlist)
const passport = require('passport');
const passportConfig = require('./auth/passport-config.js');

// Setup cookie sessions
app.use(cookieS);

// Setup passport
app.use(passport.initialize());
app.use(passport.session());

// Setup body parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize and configure passport to use local and Google strats
passportConfig.init();

// Connect to Mongo DB using mongoose
const mongoose = require('mongoose');
const User = require('./auth/user-model.js');

mongoose.connect(process.env.MONGODB_URI);

// Allows for path resolution, which is required by express
const path = require('path');

// Import Amazon Web Services sdk
const AWS = require('aws-sdk');

// Create a new polly object to handle requests
const polly = new AWS.Polly();

// Integrate socket.io
const server = http.Server(app);
const io = require('socket.io')(server);

// Import a random word generator
const randomWords = require('random-words');

// Environment variables for server usage
const port = process.env.PORT || process.env.NODE_PORT || 3000;
const users = {};
const roomAllocations = {};
const socketRoomPairs = {};
const activeBoards = {};
const maxRoomCapacity = 8;
const boardsToUpdate = {};

// Checks to see if a socket is authenticated using passport
const socketAuthCheck = session => session.passport && session.passport.user;

// Socket middleware: Ensures that a socket is logged in properly or it rejects the connection
io.use((socket, next) => {
// Create a a fake request and response object to parse cookies
  const req = { headers: { cookie: socket.request.headers.cookie } };
  const res = { getHeader: () => {}, setHeader: () => {} };

  // Parse the socket cookie
  cookieS(req, res, () => {
    // Run the authentication check
    if (socketAuthCheck(req.session)) {
      const id = req.session.passport.user;

      // Ensure that this user has been allocated to a room
      if (!roomAllocations[id]) {
        // Close connection
        socket.emit('reject');
      } else {
        // Tests passed, continue request
        next();
      }
    }
  });
});

// Load a board into the server's active memory
const loadBoard = (board) => {
  activeBoards[board._id] = {
    _id: board._id,
    name: board.name,
    owner: board.owner,
    board: board.board,
  };
  // Set the board's initial active count
  activeBoards[board._id].activeCount = 0;
};

// Create a new board, save it to Mongo's database, and load it into active memory
const createBoard = (name, owner, callback) => {
// Create a new board using the given values and an empty board state
  new Board({
    name,
    owner,
    board: { words: {} },
  }).save().then((newBoard) => {
    // After saving the board, load the returned data into the server's memory
    loadBoard(newBoard);

    // Run the requested follow-up function
    callback();
  });
};

// Find all existing boards on server start-up and load them into the server's memory
Board.find({}, (err, boards) => {
  if (err) throw err;

  // Iterate over the returned boards
  for (let i = 0; i < boards.length; i++) {
    // Load each board into the server's memory
    const board = boards[i];
    loadBoard(board);
  }
});

// Queue a board to be synced with Mongo's database
const queueBoardUpdate = (boardId) => {
// Flag the board for an update
  boardsToUpdate[boardId] = true;
};

// Takes all boards that have been queued to update and requests Mongo to update them
const updateBoards = () => {
// Grab the boards to update
  const updateList = Object.keys(boardsToUpdate);

  for (let i = 0; i < updateList.length; i++) {
    const updateItem = updateList[i];
    // If board currently needs an update
    if (boardsToUpdate[updateItem]) {
      // Set update flag to false
      boardsToUpdate[updateItem] = false;

      // Formulate a Mongo query, and pass the updated board info
      const dbQuery = { _id: updateItem };
      const updatedBoard = { board: { words: activeBoards[updateItem].board.words } };

      // Execute the Mongo update
      Board.findOneAndUpdate(dbQuery, updatedBoard, { upsert: true }, (err) => {
        if (err) throw err;
      });
    }
  }

  // Run this function again in 1 second (syncs to Mongo are delayed and grouped to avoid
  // too many calls to update the boards)
  setTimeout(updateBoards, 1000);
};

// Begin the board update loop
updateBoards();

// Examine the number of sockets connected to a room and calculate the room count
const refreshActiveCount = () => {
  const boardIds = Object.keys(activeBoards);
  const roomIds = Object.keys(io.sockets.adapter.rooms);

  // Reset all active board counts first, rooms that
  // have 0 people may be removed from socket room list
  for (let i = 0; i < boardIds.length; i++) {
    activeBoards[boardIds[i]].activeCount = 0;
  }

  // Check each room Id
  for (let i = 0; i < roomIds.length; i++) {
    const roomId = roomIds[i];

    // If the room Id belongs to an active board, see how many sockets are connected
    if (activeBoards[roomId]) {
      activeBoards[roomId].activeCount = io.sockets.adapter.rooms[roomId].length;
    }
  }
};

// Attach a function to a socket to handle requests for a word update
const onWordUpdate = (socket) => {
  socket.on('wordUpdate', (data) => {
    // Check and parse socket cookie
    const req = { headers: { cookie: socket.request.headers.cookie } };
    const res = { getHeader: () => {}, setHeader: () => {} };

    cookieS(req, res, () => {
      // Run authentication check
      if (socketAuthCheck(req.session)) {
        const id = req.session.passport.user;

        const { word } = data;

        // If the user does not own the word, ignore the update
        if (word.owner !== id) {
          return;
        }

        // Update the word and store it locally
        word.lastUpdate = new Date().getTime();

        const key = `${word.owner}${word.content}${word.created}`;

        const boardId = socketRoomPairs[socket.id];
        activeBoards[boardId].board.words[key] = word;

        // Update all clients in the user's room except for the user
        socket.broadcast.to(boardId).emit('wordUpdate', { word });

        // Queue this board's active state to be synced with Mongo's database
        queueBoardUpdate(boardId);
      }
    });
  });
};

// Attach a function to a socket to handle delete requests
const onWordDelete = (socket) => {
  socket.on('deleteWord', (data) => {
    // Parse and process socket cookie
    const req = { headers: { cookie: socket.request.headers.cookie } };
    const res = { getHeader: () => {}, setHeader: () => {} };

    cookieS(req, res, () => {
      // Run authentication check
      if (socketAuthCheck(req.session)) {
        const id = req.session.passport.user;

        const { word } = data;

        // User must own the word to delete it
        if (word.owner !== id) {
          return;
        }

        word.lastUpdate = new Date().getTime();

        const key = `${word.owner}${word.content}${word.created}`;

        const boardId = socketRoomPairs[socket.id];

        // If the board contains the word to be deleted
        if (activeBoards[boardId].board.words[key]) {
          delete activeBoards[boardId].board.words[key];

          // Request that all connected users (in the room) delete the word
          socket.broadcast.to(boardId).emit('deleteWord', { word });

          // Queue the board for a sync with Mongo
          queueBoardUpdate(boardId);
        }
      }
    });
  });
};

// Attach a function to a socket to handle chat messages
const onChatMessage = (socket) => {
  socket.on('chatMessage', (data) => {
    // Parse and process socket cookie and authenticate user
    const req = { headers: { cookie: socket.request.headers.cookie } };
    const res = { getHeader: () => {}, setHeader: () => {} };

    cookieS(req, res, () => {
      if (socketAuthCheck(req.session)) {
        const boardId = socketRoomPairs[socket.id];

        // Send the chat message to all users in the room
        io.sockets.in(boardId).emit('chatMessage', data);
      }
    });
  });
};

// Attach a function to a socket that runs when the socket disconnects
const onDisconnect = (socket) => {
  socket.on('disconnect', () => {
    // Have the socket leave the room it was in, refresh the active count, and delete the user info
    socket.leave(socketRoomPairs[socket.id]);
    refreshActiveCount();
    delete users[socket.id];
    delete socketRoomPairs[socket.id];
  });
};

// When a socket initially connects, run this setup function
io.on('connection', (socket) => {
// Attach some listeners to the socket
  onWordUpdate(socket);
  onWordDelete(socket);
  onChatMessage(socket);
  onDisconnect(socket);

  // Allocate some memory for socket info
  users[socket.id] = {};

  // Extract Passport session using sockets
  // Code: https://stackoverflow.com/questions/27174566/how-do-i-access-cookie-session-middleware-in-socket-io-on-nodejs
  const req = { headers: { cookie: socket.request.headers.cookie } };
  const res = { getHeader: () => {}, setHeader: () => {} };

  cookieS(req, res, () => {
    if (socketAuthCheck(req.session)) {
      const id = req.session.passport.user;

      // Find the user by their id (they should not be able to connect if they haven't logged in)
      User.findById(id).then((user) => {
        const username = user.google.username || user.local.username || 'Unknown';
        users[socket.id].name = username;

        // Obtain credentials and communicate them to the user
        socket.emit('credentials', { username, id: user._id });

        // Generate a random array of words and send them to the user
        socket.emit('wordbank', randomWords({ min: 20, max: 22, maxLength: 20 }));

        const boardId = roomAllocations[id];

        // If user has not been allocated to a board do not continue
        if (!boardId) {
          return;
        }

        // Link and join socket to room, and update the room's user count
        socketRoomPairs[socket.id] = boardId;
        socket.join(boardId);
        refreshActiveCount();

        // If board contains no words
        if (!activeBoards[boardId].board.words) {
          return;
        }

        // Collect the room's current array of words and send them to the newly connected user
        const wordKeys = Object.keys(activeBoards[boardId].board.words);
        for (let i = 0; i < wordKeys.length; i++) {
          socket.emit('wordUpdate', { word: activeBoards[boardId].board.words[wordKeys[i]] });
        }
      });
    }
  });
});

// Middleware to check if the user is logged in
const isLoggedIn = (req, res, next) => {
// Passport attaches a user object to requests of users that are logged in
  if (!req.user) {
    // Redirect to the login screen
    res.redirect('/login.html');
  } else {
    // Continue to the next process
    next();
  }
};

// Middleware to check if the user logged in specifically as a Google Plus user
const hasGoogleId = (req, res, next) => {
  if (req.user) {
    // Find the user in the database
    User.findById(req.user).then((user) => {
      // If they have a Google Id, proceed
      if (user.google && user.google.googleId) {
        next();
      } else {
        // Reject access to the resource
        res.status(401).send();
      }
    });
  } else {
    // Redirect to the login page
    res.redirect('/login.html');
  }
};

// If none of the defined routes are successful, catch here and process the request
const catchHiddenRequests = (req, res) => {
  switch (req.originalUrl) {
    // Redirect to the members / login page depending on login status
    case '/':
      if (req.user) {
        res.redirect('/members');
      } else {
        res.redirect('/login.html');
      }
      break;
      // Unknown resource sends a 404
    default:
      res.status(404).send('404 - Requested Resource Not Found');
      break;
  }
};

// Route requests to /auth/google to passport's Google strat
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));

// Route request to /auth/guest to passport's Local strat
// (success goes to members, failure goes to login)
app.post('/auth/guest', passport.authenticate('guest-login', {
  successRedirect: '/members',
  failureRedirect: '/login.html',
}));

// Route authenticated requests back to passport's Google strat
app.get('/authenticated', passport.authenticate('google'), (req, res) => {
// Redirec to member's page
  res.redirect('/members');
});

// Handle TTS requests and pass back audio stream
app.post('/request-tts', isLoggedIn, (req, res) => {
// Ask Amazon Polly to synthesize speech using their ssml markup language
  polly.synthesizeSpeech({
    OutputFormat: 'mp3',
    Text: req.body.text,
    TextType: 'ssml',
    // VoiceId: 'Mizuki', //Japanese voice
    VoiceId: 'Nicole',
  }, (err, data) => {
    // If TTS failed, return 400 error
    if (err) {
      res.status(400).send(err);
    } else {
      // On TTS success, create a stream of the mp3 and send it to the user
      // Streaming tech taken from:
      // https://medium.com/@smcelhinney/building-a-greeting-app-using-amazon-polly-and-nodejs-a605f29c20f5
      const bufferStream = new stream.PassThrough();
      bufferStream.end(Buffer.from(data.AudioStream));

      res.set({ 'Content-Type': 'audio/mpeg' });

      bufferStream.on('error', (bufferErr) => {
        res.status(400).send(bufferErr);
      });

      bufferStream.pipe(res);
    }
  });
});

// Handle requests to get the available boards
app.get('/members/getBoards', isLoggedIn, (req, res) => {
  refreshActiveCount();
  // Retrieve all boards in Mongo's database
  Board.find({}, (err, boards) => {
    // Format data
    const data = boards.map((boardObj) => {
      let activeCount = 0;

      // If the board is active, attempt to retrieve its user count
      if (activeBoards[boardObj._id] && activeBoards[boardObj._id].activeCount) {
        ({ activeCount } = { activeCount: activeBoards[boardObj._id].activeCount });
      }

      // Create and return the modified board object
      const newBoard = {
        id: boardObj._id,
        name: boardObj.name,
        activeCount,
      };

      return newBoard;
    });

    // Send all of the data back to the user
    res.send(JSON.stringify(data));
  });
});

// Handle requests to create a new board (must be logged in as Google Plus user)
app.post('/members/createBoard', isLoggedIn, hasGoogleId, (req, res) => {
// Find the user, create a new board, and respond with a 201 on success
  User.findById(req.user).then((user) => {
    createBoard(req.body.boardname, user.google.googleId, () => { res.status(201).send(); });
  });
});

// Handle requests to visit the members section of the site
app.get(['/members/index.html', '/members'], isLoggedIn, (req, res, next) => {
  refreshActiveCount();
  const parsedUrl = url.parse(req.url);
  const params = query.parse(parsedUrl.query);

  // Check the query string for the requested board
  if (params.board
&& activeBoards[params.board]
&& activeBoards[params.board].activeCount < maxRoomCapacity) {
    // If the board exists allocate the user to the board and continue
    roomAllocations[req.user._id] = params.board;
    next();
  } else {
    // If the board doesn't exist, redirect the user to the board select page
    res.redirect('/members/board-select.html');
  }
});

// Setup a catch all route for /members and /
app.use('/members/', isLoggedIn, express.static(path.resolve(`${__dirname}/../members`)), catchHiddenRequests);
app.use('/', express.static(path.resolve(`${__dirname}/../client`)), catchHiddenRequests);

// Start express powered http server
server.listen(port);
