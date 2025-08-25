require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to DB');

  const FaqSchema = new mongoose.Schema({ title: String, content: String, lastUpdated: Date });
  const Faq = mongoose.model('Faq', FaqSchema, 'faqs');

  const faqs = await Faq.find().sort({ lastUpdated: -1 });
  console.log('Fetched FAQs:', faqs.length);
  console.log('Details:', faqs); // Full array

  mongoose.connection.close();
}).catch(err => console.error('Connection error:', err));
