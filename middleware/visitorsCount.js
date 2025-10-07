const Visitor = require('../models/visitor'); 

exports.trackUniqueVisitor = async (req, res, next) => {
    // Check if a session ID exists (it should, after the session middleware runs)
    const sessionId = req.session.id;

    if (sessionId) {
        try {
            // Find one record by sessionId. If it doesn't exist, create it (upsert: true).
            // $setOnInsert ensures we only set the 'firstVisit' date upon the initial insert.
            await Visitor.findOneAndUpdate(
                { sessionId: sessionId },
                { $setOnInsert: { firstVisit: new Date() } }, 
                { 
                    upsert: true, 
                    new: true, 
                    runValidators: true 
                }
            );
        } catch (error) {
           
            if (error.code !== 11000) {
                 console.error("Error tracking unique visitor:", error);
            }
        }
    }
    
    next();
};