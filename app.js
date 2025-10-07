const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const passport = require('passport');
const mongoose = require('mongoose');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const cloudinary = require('./config/cloudinary');
const { getImageUrl } = require('./helper/imageHandler');;
const headerload = require('./middleware/header')
const visitorTracker = require('./middleware/visitorsCount');
const noCache = require('./middleware/noCache')




dotenv.config();


// Initialize Express
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.locals.getImageUrl = getImageUrl;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(noCache);

// Session store
const store = new MongoDBStore({
  uri: process.env.MONGO_URI ,
  collection: 'sessions',
  dbName:'superkicks'

});
store.on('error', (error) => {
  console.error('Session store error:', error);
});

app.use(
  session({
    secret: process.env.SESSION_SECRET ,
    resave: false,
    saveUninitialized: true,
    store,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    },
  })
);
app.use(visitorTracker.trackUniqueVisitor);
// Passport 
app.use(passport.initialize());
app.use(passport.session());

mongoose.connect(process.env.MONGO_URI , {
dbName:'superkicks'
})
  .then(() => console.log('Connected to MongoDB',mongoose.connection.name))
  .catch((err) => console.error('MongoDB connection error:', err));


try {
  require('./config/passport');
} catch (err) {
  console.error('Error loading passport config:', err);
}

app.use((req,res,next)=>{
  console.log("---")
  console.log(req.method);
  console.log(req.url);
  console.log(req.body,"--->body")
  next();
})

// Routes
app.use(headerload)
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