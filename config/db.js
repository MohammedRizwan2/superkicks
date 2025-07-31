const mongoose = require('mongoose')

const connectDB = async ()=>{
    try{
     await mongoose.connect(process.env.MONGO_URI);
     console.log("connected to the database")
    }
     catch(err){
       console.error("mongoDB connection error:"+err)
       process.exit(1);
     }
}
module.exports=connectDB;
