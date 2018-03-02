const http = require('http');
const url = require('url');
const query = require('querystring');
const express = require('express');

const app = express();
const bodyParser = require('body-parser');
const stream = require('stream');

const Board = require('./board-model.js');

// Set up cookie session
const cookieSession = require('cookie-session');

const cookieS = cookieSession({
  maxAge: 4 * 60 * 60 * 1000,
  keys: [process.env.COOKIE_SECRET],
});

// Environment Vars
const users = {};
const roomAllocations = {};
const socketRoomPairs = {};
// const words = {};

const activeBoards = {};
const maxRoomCapacity = 8;
const boardsToUpdate = {};

// Integrate socket.io
const server = http.Server(app);
const io = require('socket.io')(server);
const randomWords = require('random-words');

const socketAuthCheck = session => session.passport && session.passport.user;

io.use((socket, next) => {
  const req = { headers: { cookie: socket.request.headers.cookie } };
  const res = { getHeader: () => {}, setHeader: () => {} };

  cookieS(req, res, () => {
    if (socketAuthCheck(req.session)) {
      const id = req.session.passport.user;

      if (!roomAllocations[id]) {
        socket.emit('reject');
      } else {
        next();
      }
    }
  });
});

// Start of board handling code
const createBoard = (name, owner, callback) => {
  new Board({
    name,
    owner,
    board: { NullData: 'Empty String', words: {} },
  }).save().then((newBoard) => {
    activeBoards[newBoard._id] = {
      _id: newBoard._id,
      name: newBoard.name,
      owner: newBoard.owner,
      board: newBoard.board,
    };
    activeBoards[newBoard._id].activeCount = 0;

    callback();
  });
};

Board.find({}, (err, boards) => {
  if (err) throw err;

  for (let i = 0; i < boards.length; i++) {
    const board = boards[i];
    activeBoards[board._id] = {
      _id: board._id,
      name: board.name,
      owner: board.owner,
      board: board.board,
    };
    activeBoards[board._id].activeCount = 0;
  }
});

const queueBoardUpdate = (boardId) => {
  boardsToUpdate[boardId] = true;
};

const updateBoards = () => {
  const updateList = Object.keys(boardsToUpdate);

  // let counter = 0;

  for (let i = 0; i < updateList.length; i++) {
    const updateItem = updateList[i];
    if (boardsToUpdate[updateItem]) {
      boardsToUpdate[updateItem] = false;

      const dbQuery = { _id: updateItem };
      const updatedBoard = { board: { words: activeBoards[updateItem].board.words } };
      Board.findOneAndUpdate(dbQuery, updatedBoard, { upsert: true }, (err) => {
        if (err) throw err;
      });

      // counter++;
    }
  }

  // console.log("Boards Updated " + counter);

  setTimeout(updateBoards, 1000);
};

updateBoards();

// End of board handling code

const refreshActiveCount = () => {
  const boardIds = Object.keys(activeBoards);
  const roomIds = Object.keys(io.sockets.adapter.rooms);

  // Reset all active board counts first, rooms that
  // have 0 people may be removed from socket room list
  for (let i = 0; i < boardIds.length; i++) {
    activeBoards[boardIds[i]].activeCount = 0;
  }

  for (let i = 0; i < roomIds.length; i++) {
    const roomId = roomIds[i];

    if (activeBoards[roomId]) {
      activeBoards[roomId].activeCount = io.sockets.adapter.rooms[roomId].length;
    }
  }
};

// Really helpful passport tut: https://www.youtube.com/watch?v=5VHBy2PjxKs (entire playlist)
const passport = require('passport');
const passportConfig = require('./auth/passport-config.js');

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

const port = process.env.PORT || process.env.NODE_PORT || 3000;

// Setup cookie sessions
app.use(cookieS);

// Setup passport
app.use(passport.initialize());
app.use(passport.session());

// Setup body parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Start express powered http server
server.listen(port);

const isLoggedIn = (req, res, next) => {
  if (!req.user) {
    res.redirect('/login.html');
  } else {
    next();
  }
};

const hasGoogleId = (req, res, next) => {
  if (req.user) {
    User.findById(req.user).then((user) => {
      if (user.google && user.google.googleId) {
        next();
      } else {
        res.status(401).send();
      }
    });
  } else {
    res.status(401).send();
  }
};

const catchHiddenRequests = (req, res) => {
  switch (req.originalUrl) {
    case '/':
      if (req.user) {
        res.redirect('/members');
      } else {
        res.redirect('/login.html');
      }
      break;
    default:
      res.status(404).send('404 - Requested Resource Not Found');
      break;
  }
};

app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));

app.post('/auth/guest', passport.authenticate('guest-login', {
  successRedirect: '/members',
  failureRedirect: '/login.html',
}));

app.get('/authenticated', passport.authenticate('google'), (req, res) => {
  res.redirect('/members');
});

app.post('/request-tts', (req, res) => {
  polly.synthesizeSpeech({
    OutputFormat: 'mp3',
    Text: req.body.text,
    TextType: 'ssml',
    // VoiceId: 'Mizuki',
    VoiceId: 'Nicole',
  }, (err, data) => {
    if (err) {
      res.status(400).send(err);
    } else {
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

app.get('/members/getBoards', isLoggedIn, (req, res) => {
  refreshActiveCount();
  Board.find({}, (err, boards) => {
    const data = boards.map((boardObj) => {
      let activeCount = 0;

      if (activeBoards[boardObj._id] && activeBoards[boardObj._id].activeCount) {
        ({ activeCount } = { activeCount: activeBoards[boardObj._id].activeCount });
      }

      const newBoard = {
        id: boardObj._id,
        name: boardObj.name,
        board: boardObj.board,
        activeCount,
      };

      return newBoard;
    });

    res.send(JSON.stringify(data));
  });
});

app.post('/members/createBoard', isLoggedIn, hasGoogleId, (req, res) => {
  User.findById(req.user).then((user) => {
    createBoard(req.body.boardname, user.google.googleId, () => { res.status(201).send(); });
  });
});

app.get(['/members/index.html', '/members'], isLoggedIn, (req, res, next) => {
  refreshActiveCount();
  const parsedUrl = url.parse(req.url);
  const params = query.parse(parsedUrl.query);
  if (params.board
&& activeBoards[params.board]
&& activeBoards[params.board].activeCount < maxRoomCapacity) {
    roomAllocations[req.user._id] = params.board;
    next();
  } else {
    res.redirect('/members/board-select.html');
  }
});

app.use('/members/', isLoggedIn, express.static(path.resolve(`${__dirname}/../members`)), catchHiddenRequests);
app.use('/', express.static(path.resolve(`${__dirname}/../client`)), catchHiddenRequests);

const onWordUpdate = (socket) => {
  socket.on('wordUpdate', (data) => {
    const req = { headers: { cookie: socket.request.headers.cookie } };
    const res = { getHeader: () => {}, setHeader: () => {} };

    cookieS(req, res, () => {
      if (socketAuthCheck(req.session)) {
        const id = req.session.passport.user;

        const { word } = data;

        if (word.owner !== id) {
          return;
        }

        word.lastUpdate = new Date().getTime();

        const key = `${word.owner}${word.content}${word.created}`;

        const boardId = socketRoomPairs[socket.id];
        activeBoards[boardId].board.words[key] = word;

        socket.broadcast.to(boardId).emit('wordUpdate', { word });

        queueBoardUpdate(boardId);
      }
    });
  });
};

const onWordDelete = (socket) => {
  socket.on('deleteWord', (data) => {
    const req = { headers: { cookie: socket.request.headers.cookie } };
    const res = { getHeader: () => {}, setHeader: () => {} };

    cookieS(req, res, () => {
      if (socketAuthCheck(req.session)) {
        const id = req.session.passport.user;

        const { word } = data;

        if (word.owner !== id) {
          return;
        }

        word.lastUpdate = new Date().getTime();

        const key = `${word.owner}${word.content}${word.created}`;

        const boardId = socketRoomPairs[socket.id];

        console.log(key);

        if (activeBoards[boardId].board.words[key]) {
          delete activeBoards[boardId].board.words[key];

          socket.broadcast.to(boardId).emit('deleteWord', { word });

          queueBoardUpdate(boardId);
        }
      }
    });
  });
};

const onChatMessage = (socket) => {
  socket.on('chatMessage', (data) => {
    const req = { headers: { cookie: socket.request.headers.cookie } };
    const res = { getHeader: () => {}, setHeader: () => {} };

    cookieS(req, res, () => {
      if (socketAuthCheck(req.session)) {
        const boardId = socketRoomPairs[socket.id];

        io.sockets.in(boardId).emit('chatMessage', data);
      }
    });
  });
};

const onDisconnect = (socket) => {
  socket.on('disconnect', () => {
    socket.leave(socketRoomPairs[socket.id]);
    refreshActiveCount();
    delete users[socket.id];
    delete socketRoomPairs[socket.id];
  });
};

io.on('connection', (socket) => {
  onWordUpdate(socket);
  onWordDelete(socket);
  onChatMessage(socket);
  onDisconnect(socket);

  users[socket.id] = {};

  // Extract Passport session using sockets
  // Code: https://stackoverflow.com/questions/27174566/how-do-i-access-cookie-session-middleware-in-socket-io-on-nodejs
  const req = { headers: { cookie: socket.request.headers.cookie } };
  const res = { getHeader: () => {}, setHeader: () => {} };

  cookieS(req, res, () => {
    if (socketAuthCheck(req.session)) {
      const id = req.session.passport.user;

      User.findById(id).then((user) => {
        const username = user.google.username || user.local.username || 'Unknown';
        users[socket.id].name = username;
        socket.emit('credentials', { username, id: user._id });
        socket.emit('wordbank', randomWords({ min: 20, max: 22, maxLength: 20 }));

        const boardId = roomAllocations[id];

        if (!boardId) {
          return;
        }

        socketRoomPairs[socket.id] = boardId;
        socket.join(boardId);
        refreshActiveCount();

        const wordKeys = Object.keys(activeBoards[boardId].board.words);
        for (let i = 0; i < wordKeys.length; i++) {
          socket.emit('wordUpdate', { word: activeBoards[boardId].board.words[wordKeys[i]] });
        }
      });
    }
  });
});
