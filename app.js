const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const passport = require('passport');
const mongoose = require('mongoose');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');


dotenv.config();


// Initialize Express
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session store
const store = new MongoDBStore({
  uri: process.env.MONGO_URI || 'mongodb://localhost/superkicks',
  collection: 'sessions',
});
store.on('error', (error) => {
  console.error('Session store error:', error);
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      maxAge: 60 * 60 * 1000, // 1 hour
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost/superkicks', {

})
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// passport config();
try {
  require('./config/passport');
} catch (err) {
  console.error('Error loading passport config:', err);
}

app.use((req,res,next)=>{
  console.log("---")
  console.log(req.method);
  console.log(req.url);
  next();
})

// Routes
app.use('/user', userRoutes);
app.use('/admin', adminRoutes);

app.use('/', require('./routes/index')); 

// Error handling
app.use((req, res) => {
  res.status(404).render('error/404', { title: '404 Not Found' });
});
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  res.status(500).render('error/500', { title: 'Server Error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});