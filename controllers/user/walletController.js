const mongoose = require('mongoose');
const Wallet = require('../../models/wallet'); // Adjust the path to your Wallet model
const User = require('../../models/userSchema'); // Adjust the path to your User model

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

// Render Wallet Page
exports.renderWallet = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.redirect('/login'); // Redirect to login if user is not authenticated
    }

    // Fetch wallet data (non-lean to allow updates)
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      // If wallet doesn't exist, create one with default values
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
      // Generate referral code if not set
      wallet.referralStats.referralCode = await generateUniqueReferralCode();
      await wallet.save();
    }

    const walletPlain = wallet.toObject();

    // Fetch user data
    const user = await User.findById(userId).select('name email phone').lean();
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Transform wallet data for frontend
    const walletData = {
      balance: walletPlain.balance || 0,
      transactions: walletPlain.transactions.map(tx => ({
        transactionId: tx.transactionId,
        type: tx.type.toLowerCase(), // Convert to lowercase for frontend consistency
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
    // Render wallet page
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

// API: Get Wallet Balance
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

// API: Apply Referral Code
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

    // Update referred user's wallet
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

    // Update referrer's wallet
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