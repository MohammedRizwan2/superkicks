const orderItem =  require('../models/orderItem');
const Product = require('../models/product')

exports.getFeaturedProduct = async () => {
   
    const topSeller = await orderItem.aggregate([
        { 
            $group: { 
                _id: "$productId", 
                totalSold: { $sum: "$quantity" } 
            } 
        },
        { $sort: { totalSold: -1 } },
        { $limit: 1 }
    ]);

    const topProductId = topSeller[0]?._id;
    if (!topProductId) return null;

   
    const featuredProduct = await Product.aggregate([
      
        { $match: { _id: topProductId } },

  
        {
            $lookup: {
                from: 'variants',
                localField: 'variants',
                foreignField: '_id',
                as: 'variantDocs'
            }
        },

        {
            $addFields: {
              
                bestOffer: { $ifNull: ["$offer", 0] },
                
            
                lowestPrice: { $min: "$variantDocs.regularPrice" },
                
               
                lowestSalePrice: { $min: "$variantDocs.salePrice" }
            }
        },
        
   
        {
            $project: {
                _id: 1,
                productName: 1,
                description: 1,
                brand: 1,
                offer: 1, 
                images: 1,
                bestOffer: 1,
                lowestPrice: 1,
                lowestSalePrice: 1,
              
               
            }
        }
    ]);
    
    
    return featuredProduct[0] || null;
};