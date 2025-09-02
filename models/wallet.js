const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true 
  },
  balance: { 
    type: Number, 
    default: 0, 
    min: 0 
  },
  transactions: [{
    transactionId: { 
      type: String, 
      required: true,
      unique: true 
    },
    type: { 
      type: String, 
      enum: ['CREDIT', 'DEBIT'], 
      required: true 
    },
    amount: { 
      type: Number, 
      required: true,
      min: 0 
    },
    description: { 
      type: String, 
      required: true 
    },
    category: {
      type: String,
      enum: ['ORDER_PAYMENT', 'ORDER_REFUND', 'REFERRAL_BONUS', 'WALLET_TOPUP'],
      required: true
    },
    reference: {
      type: { 
        type: String, 
        enum: ['ORDER', 'REFERRAL', 'TOPUP']
      },
      referenceId: String // Order ID, Referral ID, Payment ID
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'COMPLETED'
    },
    balanceBefore: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  referralStats: {
    totalReferrals: { type: Number, default: 0 },
    totalReferralEarnings: { type: Number, default: 0 },
    referredBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    referralCode: { 
      type: String, 
      unique: true,
      sparse: true 
    }
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { 
  timestamps: true 
});

walletSchema.index({ userId: 1 });
walletSchema.index({ 'transactions.transactionId': 1 });
walletSchema.index({ 'transactions.createdAt': -1 });
walletSchema.index({ 'referralStats.referralCode': 1 });

module.exports = mongoose.model('Wallet', walletSchema);
