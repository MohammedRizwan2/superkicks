const mongoose = require('mongoose');
const Wallet = require('../../models/wallet'); 
const User = require('../../models/userSchema'); 

// Generate unique referral code
async function generateUniqueReferralCode() {
  let code;
  let exists = true;
  while (exists) {
    code = `REF${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    exists = await Wallet.findOne({ 'referralStats.referralCode': code });
  }
  return code;
}

exports.renderWallet = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.redirect('/login'); 
    }

     
    let wallet = await Wallet.findOne({ userId });
  
    if (!wallet) {
      
      wallet = new Wallet({
        userId,
        balance: 0,
        transactions: [],
        referralStats: {
          totalReferrals: 0,
          totalReferralEarnings: 0,
          referralCode: await generateUniqueReferralCode(),
        },
        isActive: true,
      });
      await wallet.save();
    } else if (!wallet.referralStats.referralCode) {
      
      wallet.referralStats.referralCode = await generateUniqueReferralCode();
      await wallet.save();
    }

    const walletPlain = wallet.toObject();

    
    const user = await User.findById(userId).select('name email phone').lean();
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const transactions = walletPlain.transactions||0;
    
    const totalSpent = transactions.filter(tx=>tx.type==="DEBIT"&&tx.category==="ORDER_REFUND")
    .reduce((sum,tx)=>sum+=tx.amount,0);
    
    const refundsReceived = transactions.filter(tx=>tx.type==="CREDIT"&&tx.category==="ORDER_REFUND")
    .reduce((sum,tx)=>sum+=tx.amount,0);

    const referralBonus = transactions.filter(tx=>tx.type==="CREDIT"&&tx.category==="REFERRAL_BONUS")
    .reduce((sum,tx)=>sum+=tx.amount,0);



    const walletData = {
      balance: walletPlain.balance || 0,
      totalSpent,
      refundsReceived,
      referralBonus,
      transactions: walletPlain.transactions.map(tx => ({
        transactionId: tx.transactionId,
        type: tx.type.toLowerCase(), 
        amount: tx.amount,
        description: tx.description,
        category: tx.category,
        orderId: tx.reference?.referenceId && tx.reference.type === 'ORDER' ? tx.reference.referenceId : null,
        referredUser: tx.reference?.referenceId && tx.reference.type === 'REFERRAL' ? tx.reference.referenceId : null,
        status: tx.status.toLowerCase(),
        date: tx.createdAt,
      })),
      referralCode: walletPlain.referralStats.referralCode || 'N/A',
      referralEarnings: walletPlain.referralStats.totalReferralEarnings || 0,
      referralCount: walletPlain.referralStats.totalReferrals || 0,
      hasBeenReferred: !!walletPlain.referralStats.referredBy,
    };
console.log(walletData)

    res.render('user/wallet', {
      user,
      wallet: walletData,
    });
  } catch (error) {
    console.error('Render wallet error:', error);
    res.status(500).render('error', {
      message: 'Failed to load wallet. Please try again.',
      error,
    });
  }
};


exports.getWalletBalance = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const wallet = await Wallet.findOne({ userId }).select('balance').lean();
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    res.json({ success: true, balance: wallet.balance });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch wallet balance' });
  }
};


exports.applyReferralCode = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { referralCode } = req.body;
    if (!referralCode) {
      return res.status(400).json({ success: false, error: 'Referral code required' });
    }

    const referredWallet = await Wallet.findOne({ userId });
    if (!referredWallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    if (referredWallet.referralStats.referredBy) {
      return res.status(400).json({ success: false, error: 'You have already been referred' });
    }

    const referrerWallet = await Wallet.findOne({ 'referralStats.referralCode': referralCode.toUpperCase() });
    if (!referrerWallet) {
      return res.status(400).json({ success: false, error: 'Invalid referral code' });
    }

    if (referrerWallet.userId.toString() === userId) {
      return res.status(400).json({ success: false, error: 'Cannot use your own referral code' });
    }


    const referredBalanceBefore = referredWallet.balance;
    referredWallet.balance += 100;
    referredWallet.referralStats.referredBy = referrerWallet.userId;
    referredWallet.transactions.push({
      transactionId: `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`,
      type: 'CREDIT',
      amount: 100,
      description: 'Referral bonus for using code',
      category: 'REFERRAL_BONUS',
      reference: { type: 'REFERRAL', referenceId: referrerWallet.userId.toString() },
      status: 'COMPLETED',
      balanceBefore: referredBalanceBefore,
      balanceAfter: referredWallet.balance,
      createdAt: new Date(),
    });
    await referredWallet.save();


    const referrerBalanceBefore = referrerWallet.balance;
    referrerWallet.balance += 200;
    referrerWallet.referralStats.totalReferrals += 1;
    referrerWallet.referralStats.totalReferralEarnings += 200;
    referrerWallet.transactions.push({
      transactionId: `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`,
      type: 'CREDIT',
      amount: 200,
      description: `Referral bonus for referring user ${userId}`,
      category: 'REFERRAL_BONUS',
      reference: { type: 'REFERRAL', referenceId: userId },
      status: 'COMPLETED',
      balanceBefore: referrerBalanceBefore,
      balanceAfter: referrerWallet.balance,
      createdAt: new Date(),
    });
    await referrerWallet.save();

    res.json({ success: true, message: 'Referral applied successfully' });
  } catch (error) {
    console.error('Apply referral code error:', error);
    res.status(500).json({ success: false, error: 'Failed to apply referral code' });
  }
};

module.exports = exports;