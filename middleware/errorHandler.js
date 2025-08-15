module.exports.logErrors = (err, req, res, next) => {
  console.error('Error:', err.stack);
  next(err);
};

module.exports.errorHandler = (err, req, res, next) => {
  res.status(err.status || 500);
  res.render('error/500', { 
    title: 'Error',
    message: err.message || 'Something broke!' 
  });
};