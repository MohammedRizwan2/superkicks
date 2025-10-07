const mongoose = require('mongoose');


const visitorSchema = new mongoose.Schema({
    sessionId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    firstVisit: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Visitor', visitorSchema);
