const mongoose = require('mongoose');
const Coupon = require('../../models/coupon');
const { HTTP_STATUS, MESSAGES } = require('../../config/constant'); 

function normalize(payload) {
  const data = {
    code: payload.code?.trim().toUpperCase(),
    description: (payload.description || '').trim(),
    type: payload.type,
    value: Number(payload.value),
    maxDiscount: Number(payload.maxDiscount || 0),
    minOrder: Number(payload.minOrder || 0),
    usageLimit: Number(payload.usageLimit || 0),
    perUserLimit: Number(payload.perUserLimit || 0),
    startDate: new Date(payload.startDate),
    endDate: new Date(payload.endDate),
    isActive: payload.isActive === true || payload.isActive === 'true' || payload.isActive === 'on'
  };
  return data;
}

function validatePayload(d) {
  const errors = [];
  if (!d.code || d.code.length < 3) errors.push('Code must be at least 3 characters');
  if (!['PERCENT', 'FLAT'].includes(d.type)) errors.push('Invalid type');
  if (!Number.isFinite(d.value) || d.value <= 0) errors.push('Value must be positive');

  if (d.type === 'PERCENT') {
    if (d.value > 100) errors.push('Percentage cannot exceed 100');
    if (!Number.isFinite(d.maxDiscount) || d.maxDiscount < 0) errors.push('Max discount must be >= 0');
  } else {
    if (d.maxDiscount && d.maxDiscount !== 0) errors.push('Max discount applies only to PERCENT coupons');
  }

  if (!Number.isFinite(d.minOrder) || d.minOrder < 0) errors.push('Minimum order must be >= 0');
  if (!Number.isFinite(d.usageLimit) || d.usageLimit < 0) errors.push('Usage limit must be >= 0');
  if (!Number.isFinite(d.perUserLimit) || d.perUserLimit < 0) errors.push('Per-user limit must be >= 0');

  if (!(d.startDate instanceof Date) || Number.isNaN(d.startDate.getTime())) errors.push('Invalid start date');
  if (!(d.endDate instanceof Date) || Number.isNaN(d.endDate.getTime())) errors.push('Invalid end date');
  if (d.startDate && d.endDate && d.endDate <= d.startDate) errors.push('End date must be after start date');
  return errors;
}

function buildFilter(q, status) {
  const filter = {};
  if (q) filter.code = { $regex: q, $options: 'i' };
  switch (status) {
    case 'active': filter.isActive = true; break;
    case 'inactive': filter.isActive = false; break;
    case 'archived': filter.isDeleted = true; break;
    case 'unarchived': filter.isDeleted = false; break;
    default: break;
  }
  return filter;
}

// couponController.js
exports.renderCouponsPage = async (req, res) => {
  try {
    const { q, status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    if (q) query.code = { $regex: q, $options: 'i' };
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (status === 'archived') query.isDeleted = true;
    if (status === 'unarchived') query.isDeleted = false;

    const coupons = await Coupon.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Coupon.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    res.render('admin/coupon', {
      coupons,
      currentPage: parseInt(page),
      totalPages,
      total,
      prevPageUrl: page > 1 ? `/admin/coupons?page=${page - 1}&q=${q}&status=${status}` : null,
      nextPageUrl: page < totalPages ? `/admin/coupons?page=${page + 1}&q=${q}&status=${status}` : null,
      query: q || '',
      status: status || 'all',
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Get coupons error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send(MESSAGES.INTERNAL_ERROR);
  }
};

exports.list = async (req, res) => {
  try {
    const q = req.query.q?.trim() || '';
    const status = req.query.status || 'all';
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 100);
    const skip = (page - 1) * limit;

    const filter = buildFilter(q, status);

    const [items, total] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Coupon.countDocuments(filter)
    ]);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (err) {
    console.error('Coupons list error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      error: MESSAGES.INTERNAL_ERROR 
    });
  }
};

exports.create = async (req, res) => {
  try {
    const data = normalize(req.body);
    const errors = validatePayload(data);
    if (errors.length) return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      success: false, 
      error: errors 
    });

    const exists = await Coupon.findOne({ code: data.code, isDeleted: false });
    if (exists) return res.status(HTTP_STATUS.CONFLICT).json({ 
      success: false, 
      error: ['Coupon code already exists'] 
    });

    const created = await Coupon.create(data);
    return res.status(HTTP_STATUS.CREATED).json({ 
      success: true, 
      data: created,
      message: MESSAGES.CREATED
    });
  } catch (err) {
    console.error('Coupon create error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      error: MESSAGES.INTERNAL_ERROR 
    });
  }
};

exports.getOne = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      success: false, 
      error: MESSAGES.BAD_REQUEST 
    });
    
    const doc = await Coupon.findById(id).lean();
    if (!doc) return res.status(HTTP_STATUS.NOT_FOUND).json({ 
      success: false, 
      error: MESSAGES.NOT_FOUND 
    });
    
    return res.status(HTTP_STATUS.OK).json({ 
      success: true, 
      data: doc 
    });
  } catch (err) {
    console.error('Coupon get error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      error: MESSAGES.INTERNAL_ERROR 
    });
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      success: false, 
      error: MESSAGES.BAD_REQUEST 
    });

    const data = normalize(req.body);
    const errors = validatePayload(data);
    if (errors.length) return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      success: false, 
      error: errors 
    });

    const dup = await Coupon.findOne({ _id: { $ne: id }, code: data.code, isDeleted: false });
    if (dup) return res.status(HTTP_STATUS.CONFLICT).json({ 
      success: false, 
      error: ['Coupon code already exists'] 
    });

    const updated = await Coupon.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!updated) return res.status(HTTP_STATUS.NOT_FOUND).json({ 
      success: false, 
      error: MESSAGES.NOT_FOUND 
    });
    
    return res.status(HTTP_STATUS.OK).json({ 
      success: true, 
      data: updated,
      message: MESSAGES.UPDATED
    });
  } catch (err) {
    console.error('Coupon update error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      error: MESSAGES.INTERNAL_ERROR 
    });
  }
};

exports.toggle = async (req, res) => {
  try {
    const id = req.params.id;
    const isActive = !!req.body.isActive;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      success: false, 
      error: MESSAGES.BAD_REQUEST 
    });
    
    const updated = await Coupon.findByIdAndUpdate(id, { $set: { isActive } }, { new: true });
    if (!updated) return res.status(HTTP_STATUS.NOT_FOUND).json({ 
      success: false, 
      error: MESSAGES.NOT_FOUND 
    });
    
    return res.status(HTTP_STATUS.OK).json({ 
      success: true, 
      data: updated,
      message: MESSAGES.UPDATED
    });
  } catch (err) {
    console.error('Coupon toggle error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      error: MESSAGES.INTERNAL_ERROR 
    });
  }
};

exports.archive = async (req, res) => {
  try {
    const id = req.params.id;
    const isDeleted = !!req.body.isDeleted;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      success: false, 
      error: MESSAGES.BAD_REQUEST 
    });
    
    const updated = await Coupon.findByIdAndUpdate(id, { $set: { isDeleted } }, { new: true });
    if (!updated) return res.status(HTTP_STATUS.NOT_FOUND).json({ 
      success: false, 
      error: MESSAGES.NOT_FOUND 
    });
    
    return res.status(HTTP_STATUS.OK).json({ 
      success: true, 
      data: updated,
      message: isDeleted ? 'Coupon archived successfully' : 'Coupon unarchived successfully'
    });
  } catch (err) {
    console.error('Coupon archive error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      error: MESSAGES.INTERNAL_ERROR 
    });
  }
};