const Address = require('../../models/address');


exports.getAddresses = async(req,res,next)=>{
try{
    userId = req.session?.user.id
if(!userId){
    console.log("UserID not found ")
    res.redirect('/user/login');

}
console.log("hereeeeee")
const addresses= await Address.find({userId}).sort({createdAt:-1});

res.render('user/addresses',{
    isLoggedIn:true,
    user:req.session.user,
    addresses: addresses.map((a)=>({
        id:a._id.toString(),
        name:a.name,
        email:a.email,
        phone:a.phone,
        alternatePhone:a.alternatePhone,
        country:a.country,
        state:a.state,
        address:a.address,
        landmark:a.landmark,
        pinCode:a.pinCode,
        type:a.type,
        createdAt:a.createdAt

    }))
})

}
catch(err){
next(err)
}
}


exports.setDefaultAddress = async (req, res, next) => {
  try {
    const userId = req.session?.user.id;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: { code: 'UNAUTHENTICATED', message: 'Login required' } 
      });
    }

    const { id } = req.params;

    
    const address = await Address.findOne({ _id: id, userId });
    if (!address) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Address not found' }
      });
    }

    
    await Address.updateMany({ userId }, { isDefault: false });
    
  
    await Address.updateOne({ _id: id, userId }, { isDefault: true });

    return res.status(200).json({
      success: true,
      message: 'Default address updated successfully!'
    });

  } catch (err) {
    console.error('Set default address error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update default address' }
    });
  }
};




exports.addAddress = async (req, res, next) => {
  try {
    const userId = req.session?.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Login required' }
      });
    }

    const {
      name,
      email,
      phone,
      alternatePhone,
      country,
      state,
      address: addrLine,
      landmark,
      pinCode,
      type
    } = req.body;

    const errors = {};

    
    if (!name || name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    if (!email || !/^.+@.+\..+$/.test(email.trim())) {
      errors.email = 'Valid email required';
    }
    if (!phone || phone.trim().length < 10) {
      errors.phone = 'Valid phone required';
    }
    if (!country || country.trim().length < 2) {
      errors.country = 'Country is required';
    }
    if (!state || state.trim().length < 2) {
      errors.state = 'State is required';
    }
    if (!addrLine || addrLine.trim().length < 10) {
      errors.address = 'Address must be at least 10 characters';
    }
    if (!pinCode || !/^[0-9]{5,6}$/.test(pinCode.trim())) {
      errors.pinCode = 'PIN code must be 5–6 digits';
    }
    if (!type || !['home', 'work', 'other'].includes(type)) {
      errors.type = 'Address type is required';
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Fix the  validation errors', errors }
      });
    }

    // Prevent duplicates
    const existing = await Address.findOne({
      userId,
      address: addrLine.trim(),
      pinCode: pinCode.trim(),
      state: state.trim()
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'DUPLICATE_ADDRESS', message: 'This address exists' }
      });
    }

    // Create and save
    const newAddress = new Address({
      userId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      alternatePhone: alternatePhone?.trim() || '',
      country: country.trim(),
      state: state.trim(),
      address: addrLine.trim(),
      landmark: landmark?.trim() || '',
      pinCode: pinCode.trim(),
      type
    });
    await newAddress.save();

    return res.status(201).json({
      success: true,
      message: 'Address added',
      data: {
        id: newAddress._id,
        name: newAddress.name,
        address: newAddress.address,
        // etc.
      }
    });

  } catch (err) {
    console.error('Add address error:', err);


    if (res.headersSent) {
      return next(err);
    }

    if (err.name === 'ValidationError') {
      const mongooseErrors = {};
      Object.values(err.errors).forEach(e => {
        mongooseErrors[e.path] = e.message;
      });
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Fix the errors', errors: mongooseErrors }
      });
    }

    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to add address' }
    });
  }
};



exports.getUserAddresses = async (req, res, next) => {
  try {
    console.log("hello")
    const userId = req.session?.user.id;
    console.log(userId,"<<<<<"
    )
    if (!userId) {
        console.log("no user found")
      return res.status(401).json({ 
        success: false, 
        error: { code: 'UNAUTHENTICATED', message: 'Login required' } 
      });
    }

    const addresses = await Address.find({ userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: addresses.map(addr => ({
        id: addr._id.toString(),
        name: addr.name,
        email: addr.email,
        phone: addr.phone,
        alternatePhone: addr.alternatePhone,
        country: addr.country,
        state: addr.state,
        address: addr.address,
        landmark: addr.landmark,
        pinCode: addr.pinCode,
        type: addr.type,
        createdAt: addr.createdAt
      }))
    });

  } catch (err) {
    console.error('Get addresses error:', err);
    return res.status(500).json({
      success: false,
      error: { 
        code: 'INTERNAL_ERROR', 
        message: 'Failed to fetch addresses' 
      }
    });
  }
};


exports.getAddress = async (req, res, next) => {
  try {
    const userId = req.session?.user.id;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: { code: 'UNAUTHENTICATED', message: 'Login required' } 
      });
    }

    const { id } = req.params;

    const address = await Address.findOne({ _id: id, userId });
    if (!address) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Address not found' }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: address._id.toString(),
        name: address.name,
        email: address.email,
        phone: address.phone,
        alternatePhone: address.alternatePhone,
        country: address.country,
        state: address.state,
        address: address.address,
        landmark: address.landmark,
        pinCode: address.pinCode,
        type: address.type,
        createdAt: address.createdAt
      }
    });

  } catch (err) {
    console.error('Get address error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch address' }
    });
  }
};


exports.updateAddress = async (req, res, next) => {
  try {
    const userId = req.session?.user.id;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: { code: 'UNAUTHENTICATED', message: 'Login required' } 
      });
    }

    const { id } = req.params;
    const { name, email, phone, alternatePhone, country, state, address, landmark, pinCode, type } = req.body;


    const existingAddress = await Address.findOne({ _id: id, userId });
    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Address not found' }
      });
    }


    const errors = {};
    
    if (!name || name.trim().length < 2) errors.name = 'Name must be at least 2 characters long';
    if (!email || !/^.+@.+\..+$/.test(email)) errors.email = 'Please enter a valid email address';
    if (!phone || phone.trim().length < 10) errors.phone = 'Phone number must be at least 10 digits';
    if (!country || country.trim().length < 2) errors.country = 'Please select a country';
    if (!state || state.trim().length < 2) errors.state = 'State is required';
    if (!address || address.trim().length < 10) errors.address = 'Address must be at least 10 characters long';
    if (!pinCode || !/^[0-9]{5,6}$/.test(pinCode)) errors.pinCode = 'PIN code must be 5-6 digits';
    if (!type || !['home', 'work', 'other'].includes(type)) errors.type = 'Please select an address type';

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Please fix the errors below', errors }
      });
    }


    existingAddress.name = name.trim();
    existingAddress.email = email.trim().toLowerCase();
    existingAddress.phone = phone.trim();
    existingAddress.alternatePhone = alternatePhone?.trim() || '';
    existingAddress.country = country.trim();
    existingAddress.state = state.trim();
    existingAddress.address = address.trim();
    existingAddress.landmark = landmark?.trim() || '';
    existingAddress.pinCode = pinCode.trim();
    existingAddress.type = type;

    await existingAddress.save();

    return res.status(200).json({
      success: true,
      message: 'Address updated successfully!',
      data: {
        id: existingAddress._id.toString(),
        name: existingAddress.name,
        email: existingAddress.email,
        phone: existingAddress.phone,
        alternatePhone: existingAddress.alternatePhone,
        country: existingAddress.country,
        state: existingAddress.state,
        address: existingAddress.address,
        landmark: existingAddress.landmark,
        pinCode: existingAddress.pinCode,
        type: existingAddress.type
      }
    });

  } catch (err) {
    console.error('Update address error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update address' }
    });
  }
};



exports.deleteAddress = async (req, res, next) => {
  try {
    console.log("inside deletereeeeeee")
    const userId = req.session?.user.id;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: { code: 'UNAUTHENTICATED', message: 'Login required' } 
      });
    }

    const { id } = req.params;

    // Find and verify ownership before deleting
    const address = await Address.findOne({ _id: id, userId });
    if (!address) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Address not found' }
      });
    }

    await Address.deleteOne({ _id: id, userId });

    return res.status(200).json({
      success: true,
      message: 'Address deleted successfully!'
    });

  } catch (err) {
    console.error('Delete address error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete address' }
    });
  }
};

