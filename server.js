require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const app = express();
const fs = require('fs');
// MongoDB Connection with Logging
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  dbName: 'accounting-dashboard',
  serverSelectionTimeoutMS: 30000 // Increase to 30s
}).then(() => {
  console.log('MongoDB connected successfully to accounting-dashboard');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});
mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err);
});
// Define Schemas
const AlertSchema = new mongoose.Schema({
  title: String,
  content: String,
  color: String,
  active: Boolean,
  orientation: String,
  enableTitle: Boolean,
  enableContent: Boolean
});
const Alert = mongoose.model('Alert', AlertSchema, 'alerts');
const NewsSchema = new mongoose.Schema({
  title: String,
  content: String,
  lastUpdated: Date
});
const News = mongoose.model('News', NewsSchema, 'news');
const FaqSchema = new mongoose.Schema({
  title: String,
  content: String,
  lastUpdated: Date
});
const Faq = mongoose.model('Faq', FaqSchema, 'faqs');
const FormSchema = new mongoose.Schema({
  title: String,
  content: String,
  lastUpdated: Date,
  filename: String
});
const Form = mongoose.model('Form', FormSchema, 'forms');
const ClassSchema = new mongoose.Schema({
  title: String,
  content: String,
  lastUpdated: Date,
  active: Boolean,
  roster: [{
    firstName: String,
    lastName: String,
    email: String,
    date: Date
  }]
});
const Class = mongoose.model('Class', ClassSchema, 'classes');
// Initialize Default Data if Collections are Empty
(async () => {
  try {
    if (await News.countDocuments() === 0) {
      await News.create({ title: 'Default News Title', content: 'Default news content', lastUpdated: new Date() });
      console.log('Default news initialized');
    }
    if (await Faq.countDocuments() === 0) {
      await Faq.create({ title: 'Default FAQ Title', content: 'Default FAQ content', lastUpdated: new Date() });
      console.log('Default FAQ initialized');
    }
    if (await Form.countDocuments() === 0) {
      console.log('Forms collection is empty, no defaults needed');
    }
    if (await Class.countDocuments() === 0) {
      await Class.create({ title: 'Default Class Title', content: 'Default class content', lastUpdated: new Date(), active: false, roster: [] });
      console.log('Default class initialized');
    }
    if (await Alert.countDocuments() === 0) {
      await Alert.create({ title: '', content: '', color: 'warning', active: false, orientation: 'top', enableTitle: true, enableContent: true });
      console.log('Default alert initialized');
    }
  } catch (err) {
    console.error('Error initializing defaults:', err);
  }
})();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'secret-key', resave: false, saveUninitialized: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "https://www.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https://images.pexels.com", "https://via.placeholder.com"],
      frameSrc: ["'self'", "https://www.google.com/recaptcha/"]
    }
  }
}));
// Rate limiter: 5 attempts per minute per IP for login
const rateLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60 // per minute
});
// Hashed password (uncomment and replace with your hash from bcrypt.hashSync('abc123', 10))
const hashedPassword = '$2b$10$PxRzRA6Y6nCSDZENL3flM.nptyXo/JyEbn6pkRQgYnwZucUdNGGUu';
// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/forms'); // Storage folder
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  }
});
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
  if (file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.ms-excel' || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    cb(null, true);
  } else {
    cb(new Error('Only PDFs and Excel files (.xls, .xlsx) allowed'));
  }
},
  limits: { fileSize: 12 * 1024 * 1024 } // 12MB limit
});
app.use('/forms', (req, res, next) => {
  if (req.session.captchaVerified || req.session.authenticated) {
    express.static('uploads/forms')(req, res, next);
  } else {
    res.status(403).send('Verification required');
  }
});
app.use('/images', express.static('images'));
// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }
  res.redirect('/schwertfisch');
}
// Main page: Renders data as stacked cards with Bootstrap
app.get('/', async (req, res) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const retry = require('async-retry');
    const newsData = await retry(async () => await News.find().sort({ lastUpdated: -1 }), {
  retries: 3,
  minTimeout: 1000
    });
    const faqData = await Faq.find().sort({ lastUpdated: -1 });
    const formsData = await Form.find().sort({ lastUpdated: -1 });
    const classesData = await Class.find().sort({ lastUpdated: -1 });
    const alertData = await Alert.findOne() || { title: '', content: '', color: 'warning', active: false, orientation: 'top', enableTitle: true, enableContent: true };
    console.log('Retrieved news:', newsData.length);
    console.log('Retrieved FAQs:', faqData.length);
    console.log('Retrieved forms:', formsData.length);
    console.log('Retrieved classes:', classesData.length);
    console.log('Retrieved alert:', alertData ? 'Yes' : 'No');
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>J&T Accounting</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Open Sans', sans-serif; background-color: #f8f9fa; color: #333; }
body { padding-top: 70px; }
       .navbar { background-color: #001f3f; }
        .navbar-brand { color: white; font-weight: 700; font-size: 1.5rem; }
        .nav-link { color: white; font-weight: 600; }
        .btn-contact { background-color: #ffd700; border-color: #ffd700; color: #001f3f; border-radius: 20px; font-weight: 600; }
.hero {padding: 6rem 0; display: flex; flex-direction: column; justify-content: center; align-items: center; background-image: linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url("/images/ranch.jpg"); background-size: cover; background-position: center; background-repeat: no-repeat;}
.hero-logo {
    /* Remove absolute positioning */
    position: static;
    width: 300px; /* Adjusted width for centering; adjust as needed */
    height: auto;
    margin-bottom: 1rem; /* Space below logo for the title */
 }
        .hero h1 { font-size: 3rem; font-weight: 700; }
        .description { text-align: center; padding: 2rem 0; color: #6c757d; font-size: 1.1rem; }
        .icons { text-align: center; padding: 2rem 0; }
        .icon { font-size: 3rem; color: #8fb98b; margin: 1rem; }
        .card { border: none; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 10px; }
        .card-header { background-color: #001f3f; color: white; font-weight: 600; border-top-left-radius: 10px; border-top-right-radius: 10px; }
        .section { display: none; padding: 2rem 0; }
        .section.active { display: block; }
        .btn { border-radius: 20px; font-weight: 600; }
        h2 { font-weight: 700; color: #001f3f; }
        .consultation-container { padding-bottom: 4rem; } /* Added padding to prevent alert overlap */
@media (max-width: 576px) {
  .card-body { padding: 1rem; font-size: 1rem; }
  .hero h1 { font-size: 2rem; }
  .description { font-size: 1rem; padding: 1rem 0; }
  .btn { font-size: 1rem; }
  .consultation-container { padding-bottom: 6rem; } /* Increased padding for mobile */
}
@media (max-width: 991px) {
  .navbar-collapse {
    position: relative;
    height: auto !important;
    background-color: #001f3f; /* Matches navbar bg for consistency */
  }
}
.accordion-button { background-color: #001f3f; color: white; font-weight: 600; }
.accordion-button:not(.collapsed) { background-color: #001f3f; color: white; }
.accordion-button:focus { box-shadow: none; }
      </style>
      <script src="https://www.google.com/recaptcha/api.js" async defer></script>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="#"><img src="/images/AccountingServices-R2.png" alt="Logo" style="height: 40px; margin-right: 10px;">J & T Accounting</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('home')">Home</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('about')">About</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('services')">Services</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('classes')">Classes</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('forms')">Forms</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('news')">News</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('faq')">FAQ</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('contact')">Contact</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('irs')">IRS</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('existingclients')">Existing Clients</a></li>
              <li class="nav-item"><button class="btn btn-contact ms-2" onclick="showSection('contact')">Free Consultation</button></li>
            </ul>
          </div>
        </div>
      </nav>
      <div id="home" class="section active container mt-4">
 ${alertData.active && alertData.orientation === 'top' ? `<div class="alert alert-${alertData.color}" role="alert" style="position: fixed; top: 70px; left: 0; width: 100%; z-index: 1020;">
          ${alertData.enableTitle ? `<h4 class="alert-heading">${alertData.title}</h4>` : ''}
          ${alertData.enableTitle && alertData.enableContent ? '<hr>' : ''}
          ${alertData.enableContent ? `<p class="mb-0">${alertData.content}</p>` : ''}
        </div>` : ''}
 <div class="hero">
  <img src="/images/AccountingServices-R2.png" alt="Logo" class="hero-logo">
  <h1 style="color: white; font-weight: 700; font-size: 3rem; margin: 0 0 0.5rem 0; text-align: center;">J&T Accounting Services</h1>
  <h2 style="color: white; font-weight: 400; font-size: 1.5rem; margin: 0; text-align: center;">Supporting you & your growing business.</h2>
</div>
        <img style="width: 100px; height: 100px; border-radius: 50%; display: block; margin: 2rem auto;" src="/images/US.jpg" alt="Team Photo">
        <div class="description">
          J & T Accounting provides financial guidance for businesses through planning and ongoing advisement. We also support individuals with personal accounting and tax needs. Our approach is focused on establishing relationships with our clients, so we have a vested interest in helping them achieve their strategic goals.
        </div>
        <div class="icons">
          <i class="bi bi-briefcase-fill icon"></i>
          <i class="bi bi-file-earmark-text-fill icon"></i>
          <i class="bi bi-graph-up-arrow icon"></i>
        </div>
        <div class="text-center mb-4 consultation-container">
          <button class="btn btn-contact" onclick="showSection('contact')">Schedule a Free Consultation</button>
        </div>
 ${alertData.active && alertData.orientation === 'bottom' ? `<div class="alert alert-${alertData.color}" role="alert" style="position: fixed; bottom: 0; left: 0; width: 100%; z-index: 1020;">
          ${alertData.enableTitle ? `<h4 class="alert-heading">${alertData.title}</h4>` : ''}
          ${alertData.enableTitle && alertData.enableContent ? '<hr>' : ''}
          ${alertData.enableContent ? `<p class="mb-0">${alertData.content}</p>` : ''}
        </div>` : ''}
      </div>
      <div id="about" class="section container mt-4">
        <h2>About</h2>
        <p>Hello, we're James Beltrame and Tiffiny Trupe, proud owners of J&T Accounting Services, LLC.</p>
<p>James brings over 25 years in the custom home industry as a master tradesman and project manager. During the Great Recession, he leveraged his business degree, completed an H&R Block course, and became a tax preparer. He balanced six tax seasons at Block with his construction work—until our paths crossed.</p>
<p>We met in 2016 at an H&R Block orientation, collaborating occasionally in the same office. By season's end, we launched our own practice from home, building a loyal clientele. In 2017, we opened an office and grew steadily until COVID prompted a shift to remote work. With today's technology, we deliver the same personalized service without in-person meetings. This evolution led us to relocate our practice to Utah, where we now call home. As an IRS Enrolled Agent (EA), James represents taxpayers nationwide across all 50 states.</p>
<p>As for me, Tiffiny, I'm a mom to two amazing boys. I paused my accounting career to raise them and volunteer endlessly at their schools—it felt like I lived there! After my divorce, re-entering the workforce after 13 years was tough; no recent experience meant constant rejections. Spotting an H&R Block class, I thought, "What do I have to lose?" I passed but, due to a management mix-up, started as a Client Service Professional across two offices—where I met James. We connected weekly, and the rest is history. I believe things happen for a reason: that detour let me observe and refine my approach. I'm not one for multitasking chit-chat while crunching numbers—I thrive on focus.</p>
<p>Together, we're a seamless team. I prepare every return; James reviews and we collaborate on solutions. We double-check everything, with James leading on corporate filings and IRS matters. We both love guiding businesses and cheering on our clients' success—because when they thrive, so do we!</p>
      </div>
      <div id="services" class="section container mt-4">
        <h2>Services</h2>
        <div class="row">
          <div class="col-12 col-md-6 col-lg-3 mb-3">
            <div class="card">
              <div class="card-header"><strong>Accounting</strong></div>
              <div class="card-body">
                An accountant is NOT a tax preparer and a tax preparer is NOT an accountant. Fortunately for you, we are both accountants and tax preparers. This is extremely rare. An accountant’s job is to organize all money in and out into the correct categories which in the end needs to balance. Every penny needs to be accounted for and that is what we do. Accounting must be completed before a business tax return can be started. We are QBO (QuickBooks Online) Pro Advisors and can help you set up an account and assist you throughout the year.
              </div>
            </div>
          </div>
          <div class="col-12 col-md-6 col-lg-3 mb-3">
            <div class="card">
              <div class="card-header"><strong>Taxes</strong></div>
              <div class="card-body">
                We prepare and file federal and state tax returns for C Corps, S Corps, Partnerships, Estates and Trusts and individuals. We have legal authority to file in all 50 states and represent tax payers if the need arises. An LLC is either a C Corp, S Corp, Partnership or Sole Proprietorship. It’s very important to know which you have as the filing requirements are very different.
              </div>
            </div>
          </div>
          <div class="col-12 col-md-6 col-lg-3 mb-3">
            <div class="card">
              <div class="card-header"><strong>Business Start-Up</strong></div>
              <div class="card-body">
                Should I start a business? Am I cut out for it? There are big pros and cons to doing this. You must evaluate your personal strengths, weaknesses and family life. If you decide to start a business…. what entity do I choose? Before deciding this PLEASE consult a professional. This is NOT something you can decide watching YouTube or other social media. The internet often leads people to the wrong decision. We will carefully evaluate your situation and advise on the pros and cons of each. Once the decision is made, we will help you set up the entity and guide you through the proper operation.
              </div>
            </div>
          </div>
          <div class="col-12 col-md-6 col-lg-3 mb-3">
            <div class="card">
              <div class="card-header"><strong>Business Consulting</strong></div>
              <div class="card-body">
                As a business owner sometimes, you feel alone. This is where we come in. We help analyze your business, help you make monetary decisions and help you propel forward so you can become successful. We get that you can’t talk to your employees or your family because they don’t understand or don’t have the knowledge or honestly may just have their own agenda.
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="classes" class="section container mt-4">
        <h2>Classes</h2>
        <div class="row">
          ${classesData ? classesData.map(c => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${c.title}</strong></div>
                <div class="card-body">
                  ${c.content}
                  ${c.active ? `<button class="btn btn-primary btn-sm mt-2" onclick="openSignupModal('${c._id}')">Sign Up</button>` : ''}
                </div>
                <div class="card-footer text-muted">
                  <small><i><strong>Last Updated: <span class="local-datetime" data-iso="${c.lastUpdated}">${formatter.format(new Date(c.lastUpdated))}</span></strong></i></small>
                </div>
              </div>
            </div>
          `).join('') : ''}
        </div>
      </div>
      <div id="forms" class="section container mt-4">
        <h2>Forms</h2>
        <div class="row">
          ${formsData ? formsData.map(f => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${f.title}</strong></div>
                <div class="card-body">
                  ${f.content}
                  ${f.filename ? `<button onclick="attemptDownload('/forms/${f.filename}')" class="btn btn-primary btn-sm">Download Form</button>` : ''}
                </div>
                <div class="card-footer text-muted">
                  <small><i><strong>Last Updated: <span class="local-datetime" data-iso="${f.lastUpdated}">${formatter.format(new Date(f.lastUpdated))}</span></strong></i></small>
                </div>
              </div>
            </div>
          `).join('') : ''}
        </div>
      </div>
      <div id="news" class="section container mt-4">
        <h2>News</h2>
        <div class="row">
          ${newsData ? newsData.map(n => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${n.title}</strong></div>
                <div class="card-body">
                  ${n.content}
                </div>
                <div class="card-footer text-muted">
                  <small><i><strong>Last Updated: <span class="local-datetime" data-iso="${n.lastUpdated}">${formatter.format(new Date(n.lastUpdated))}</span></strong></i></small>
                </div>
              </div>
            </div>
          `).join('') : ''}
        </div>
      </div>
      <div id="faq" class="section container mt-4">
        <h2>FAQ</h2>
        <div class="accordion" id="faqAccordion">
          ${faqData ? faqData.map((f, index) => `
            <div class="accordion-item">
              <h2 class="accordion-header" id="heading${index}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${index}" aria-expanded="false" aria-controls="collapse${index}">
                  ${f.title}
                </button>
              </h2>
              <div id="collapse${index}" class="accordion-collapse collapse" aria-labelledby="heading${index}" data-bs-parent="#faqAccordion">
                <div class="accordion-body">
                  ${f.content}
                  <small><i><strong>Last Updated: <span class="local-datetime" data-iso="${f.lastUpdated}">${formatter.format(new Date(f.lastUpdated))}</span></strong></i></small>
                </div>
              </div>
            </div>
          `).join('') : ''}
        </div>
      </div>
      <div id="contact" class="section container mt-4">
        <h2>Contact Us</h2>
        <p>See how our accounting expertise and personalized services can save you time, money, and frustration with managing your finances. We offer both free introductary consultations and fee based analysis and on going advice.</p>
        <p>Please call or use the form below to set up an appointment.</p>
        <div class="alert alert-info mb-4" role="alert">
          <p><strong>Mailing Address</strong></p>
          <p>HC 74 Box 5110</p>
          <p>Adamsville, UT 84731-5116</p>
          <p>If you are sending us information via UPS or FedEx, please contact us for an alternative address.</p>
        </div>
        <p class="mb-4">Please call for a consult or virtual appointment</p>
        <p class="mb-4">help@jandtaccounting.com</p>
        <p class="mb-4">951-409-3081</p>
        <div class="container mt-4">
          <form id="contact-form">
            <div class="mb-3">
              <label for="firstName" class="form-label">First Name (Required)</label>
              <input type="text" class="form-control" id="firstName" name="firstName" required>
            </div>
            <div class="mb-3">
              <label for="lastName" class="form-label">Last Name (Required)</label>
              <input type="text" class="form-control" id="lastName" name="lastName" required>
            </div>
            <div class="mb-3">
              <label for="email" class="form-label">Email Address (Required)</label>
              <input type="email" class="form-control" id="email" name="email" required>
            </div>
            <div class="mb-3">
              <label for="phone" class="form-label">Phone Number (Required)</label>
              <input type="tel" class="form-control" id="phone" name="phone" required>
            </div>
            <div class="mb-3">
              <label for="message" class="form-label">How Can We Help You?</label>
              <textarea class="form-control" id="message" name="message" rows="3"></textarea>
            </div>
            <button type="submit" class="btn btn-primary">Submit</button>
          </form>
        </div>
      </div>
      <div id="irs" class="section container mt-4">
        <h2>IRS</h2>
        <p>IRS Website: <a href="https://www.irs.gov">https://www.irs.gov/</a></p>
      </div>
      <div id="existingclients" class="section container mt-4">
        <h2>Existing Clients</h2>
        <p>Thanks for being a loyal customer.</p>
        <div class="alert alert-info mb-4" role="alert">
          <p><strong>Mailing Address:</strong> HC 74 Box 5110, Adamsville, UT 84731-5116</p>
          <p>If you are sending us information via UPS or FedEx, please contact us for an alternative address.</p>
        </div>
        <p class="mb-4">Email: <a href="mailto:help@jandtaccounting.com">help@jandtaccounting.com</a></p>
        <p class="mb-4">Phone: 951-409-3081</p>
        <p><a href="https://your-taxdome-url.com" target="_blank">Access Your TaxDome Site (Placeholder)</a></p>
      </div>
      <!-- CAPTCHA Modal -->
      <div class="modal fade" id="captchaModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Verify CAPTCHA to Download</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="g-recaptcha" data-sitekey="6LdrqpwrAAAAAL1wc-uV_1Ie9W_q88EIqmcmAPx1" data-callback="onCaptchaSuccess"></div>
            </div>
          </div>
        </div>
      </div>
      <!-- Signup Modal -->
      <div class="modal fade" id="signupModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Sign Up for Class</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label for="signup-first" class="form-label">First Name (Required)</label>
                <input type="text" class="form-control" id="signup-first" required>
              </div>
              <div class="mb-3">
                <label for="signup-last" class="form-label">Last Name (Required)</label>
                <input type="text" class="form-control" id="signup-last" required>
              </div>
              <div class="mb-3">
                <label for="signup-email" class="form-label">Email Address (Required)</label>
                <input type="email" class="form-control" id="signup-email" required>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" onclick="submitSignup()">Confirm</button>
            </div>
          </div>
        </div>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      <script>
        let downloadUrl = '';
        let currentClassId = '';
        function attemptDownload(url) {
          fetch('/check-verified')
            .then(response => response.json())
            .then(data => {
              if (data.verified) {
                window.location.href = url;
              } else {
                downloadUrl = url;
                var myModal = new bootstrap.Modal(document.getElementById('captchaModal'));
                myModal.show();
              }
            });
        }
        function onCaptchaSuccess(token) {
          fetch('/verify-captcha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          }).then(response => {
            if (response.ok) {
              window.location.href = downloadUrl;
            } else {
              alert('CAPTCHA verification failed');
            }
          }).finally(() => bootstrap.Modal.getInstance(document.getElementById('captchaModal')).hide());
        }
        function openSignupModal(classId) {
          currentClassId = classId;
          var myModal = new bootstrap.Modal(document.getElementById('signupModal'));
          myModal.show();
        }
        function submitSignup() {
          const first = document.getElementById('signup-first').value.trim();
          const last = document.getElementById('signup-last').value.trim();
          const email = document.getElementById('signup-email').value.trim();
          if (!first || !last || !email) {
            alert('Please fill all required fields.');
            return;
          }
          fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: first, lastName: last, email, classId: currentClassId })
          }).then(response => {
            if (response.ok) {
              alert('Signed up successfully!');
              bootstrap.Modal.getInstance(document.getElementById('signupModal')).hide();
              document.getElementById('signup-first').value = '';
              document.getElementById('signup-last').value = '';
              document.getElementById('signup-email').value = '';
            } else {
              alert('Signup failed');
            }
          });
        }
       function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  // Close navbar collapse on mobile after click
  const collapse = document.querySelector('.navbar-collapse');
  if (collapse.classList.contains('show')) {
    new bootstrap.Collapse(collapse).hide();
  }
}
        // Show home by default
        showSection('home');
        document.querySelectorAll('.local-datetime').forEach(span => {
          const date = new Date(span.dataset.iso);
          span.textContent = new Intl.DateTimeFormat(navigator.language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
        });
       document.getElementById('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const response = await fetch('/send-contact', { method: 'POST', body: formData });
  if (response.ok) {
    alert('Message sent!');
    e.target.reset();
  } else {
    const errorText = await response.text(); // Get the server's error message
    console.error('Form submission error:', errorText); // Log to browser console for debugging
    alert('Error sending message: ' + errorText); // Show detailed alert
  }
});
document.getElementById('copyright-year').textContent = new Date().getFullYear();
      </script>
     <footer>
</footer>
</body>
    </html>
  `;
    res.send(html);
  } catch (err) {
    console.error('Error rendering main page:', err);
    res.status(500).send('Server error');
  }
});
// Login page with Bootstrap
app.get('/schwertfisch', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Login</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Open Sans', sans-serif; background-color: #f8f9fa; color: #333; }
        .btn-primary { background-color: #8fb98b; border-color: #8fb98b; border-radius: 20px; font-weight: 600; color: white; }
        .btn-primary:hover { background-color: #79a076; }
        h1 { color: #001f3f; font-weight: 700; }
footer { text-align: center; margin-top: 2rem; font-size: 0.8rem; color: #6c757d; font-style: italic; }
footer a { color: #6c757d; text-decoration: underline; }
      </style>
    </head>
    <body class="container mt-4">
      <h1>Login to Dashboard</h1>
      <form method="post" action="/schwertfisch">
        <div class="mb-3">
          <label class="form-label">Username:</label>
          <input type="text" name="username" class="form-control">
        </div>
        <div class="mb-3">
          <label class="form-label">Password:</label>
          <input type="password" name="password" class="form-control">
        </div>
        <button type="submit" class="btn btn-primary">Login</button>
      </form>
    </body>
    </html>
  `);
});
app.post('/schwertfisch', async (req, res) => {
  try {
    await rateLimiter.consume(req.ip); // Rate limit by IP
    if (req.body.username === 'helpatjandt' && await bcrypt.compare(req.body.password, hashedPassword)) {
      req.session.authenticated = true;
      res.redirect('/dashboard');
    } else {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Error</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
          <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Open Sans', sans-serif; background-color: #f8f9fa; color: #333; }
            .btn-link { color: #8fb98b; font-weight: 600; }
          </style>
        </head>
        <body class="container mt-4">
          Invalid credentials. <a href="/schwertfisch" class="btn btn-link">Try again</a>
        </body>
        </html>
      `);
    }
  } catch (rejRes) {
    res.status(429).send('Too many attempts. Try again later.');
  }
});
// Dashboard page with tables, drag-drop, editing, Bootstrap
app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const newsData = await News.find().sort({ lastUpdated: -1 });
    const faqData = await Faq.find().sort({ lastUpdated: -1 });
    const formsData = await Form.find().sort({ lastUpdated: -1 });
    const classesData = await Class.find().sort({ lastUpdated: -1 });
    const alertData = await Alert.findOne() || { title: '', content: '', color: 'warning', active: false, orientation: 'top', enableTitle: true, enableContent: true };
    console.log('Retrieved news for dashboard:', newsData.length);
    console.log('Retrieved FAQs for dashboard:', faqData.length);
    console.log('Retrieved forms for dashboard:', formsData.length);
    console.log('Retrieved classes for dashboard:', classesData.length);
    console.log('Retrieved alert for dashboard:', alertData ? 'Yes' : 'No');
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
body { font-family: 'Open Sans', sans-serif; background-color: #f8f9fa; color: #333; padding-top: 70px; }
        .navbar { background-color: #001f3f; }
        .navbar-brand { color: white; font-weight: 700; font-size: 1.5rem; }
        .nav-link { color: white; font-weight: 600; }
        .table { background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .btn-success { background-color: #8fb98b; border-color: #8fb98b; border-radius: 20px; font-weight: 600; color: white; }
        .btn-primary { background-color: #001f3f; border-color: #001f3f; border-radius: 20px; font-weight: 600; color: white; }
        .btn-danger { background-color: #dc3545; border-color: #dc3545; border-radius: 20px; font-weight: 600; color: white; }
        .btn-secondary { background-color: #6c757d; border-color: #6c757d; border-radius: 20px; font-weight: 600; color: white; }
        tbody tr:hover { cursor: grab; background-color: #e9ecef; }
        .editing input { width: 100%; }
        h1, h2 { color: #001f3f; font-weight: 700; }
        .bi { font-weight: bold; font-size: 1.2rem; } /* Bold icons */
        .dimmed { opacity: 0.5; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        /* Improved navbar mobile responsiveness */
        @media (max-width: 991px) {
          .navbar-collapse {
            position: relative;
            height: auto !important;
            background-color: #001f3f;
            padding: 1rem;
          }
          .navbar-nav {
            flex-direction: column;
            align-items: flex-start;
          }
          .nav-item {
            width: 100%;
          }
          .nav-link {
            padding: 0.5rem 1rem;
            font-size: 1rem;
            width: 100%;
            text-align: left;
          }
          .nav-link:hover {
            background-color: #003087;
            border-radius: 5px;
          }
        }
        @media (max-width: 576px) {
          .navbar-brand {
            font-size: 1.2rem;
          }
          .navbar-toggler {
            padding: 0.25rem 0.5rem;
          }
          .nav-link {
            font-size: 0.9rem;
            padding: 0.4rem 0.8rem;
          }
        }
      </style>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="#">Dashboard</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link" href="#" onclick="showTab('sections')">Sections</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showTab('classes')">Classes</a></li>
              <li class="nav-item"><a class="nav-link" href="#" onclick="showTab('analytics')">Analytics</a></li>
            </ul>
          </div>
        </div>
      </nav>
      <div class="container mt-4">
        <div id="sections-tab" class="tab-content active">
          <!-- Home Page Alert Section -->
          <h2>Home Page Alert</h2>
          <div class="card mb-4">
            <div class="card-body">
              <div class="form-group mb-3 d-flex align-items-center">
                <label for="alert-title" class="me-2">Title</label>
                <div id="alert-title-switch" class="form-check form-switch me-2">
                  <input class="form-check-input" type="checkbox" id="alert-enable-title" ${alertData.enableTitle ? 'checked' : ''}>
                </div>
                <input type="text" id="alert-title" class="form-control" value="${alertData.title || ''}">
              </div>
              <div class="form-group mb-3 d-flex align-items-center">
                <label for="alert-content" class="me-2">Content</label>
                <div id="alert-content-switch" class="form-check form-switch me-2">
                  <input class="form-check-input" type="checkbox" id="alert-enable-content" ${alertData.enableContent ? 'checked' : ''}>
                </div>
                <textarea id="alert-content" class="form-control" rows="3">${alertData.content || ''}</textarea>
              </div>
              <div class="form-group mb-3">
                <label for="alert-color">Color</label>
                <select id="alert-color" class="form-control">
                  <option value="danger" ${alertData.color === 'danger' ? 'selected' : ''}>Red</option>
                  <option value="warning" ${alertData.color === 'warning' ? 'selected' : ''}>Yellow</option>
                  <option value="success" ${alertData.color === 'success' ? 'selected' : ''}>Green</option>
                  <option value="light" ${alertData.color === 'light' ? 'selected' : ''}>White</option>
                </select>
              </div>
              <div class="form-group mb-3">
                <label for="alert-orientation">Orientation</label>
                <select id="alert-orientation" class="form-control">
                  <option value="top" ${alertData.orientation === 'top' ? 'selected' : ''}>Top</option>
                  <option value="bottom" ${alertData.orientation === 'bottom' ? 'selected' : ''}>Bottom</option>
                </select>
              </div>
              <div class="form-group mb-3">
                <label for="alert-active">Active</label>
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" id="alert-active" ${alertData.active ? 'checked' : ''}>
                </div>
              </div>
            </div>
          </div>
          <!-- News Section -->
          <h2>News</h2>
          <div class="table-responsive">
  <table id="news-table" class="table table-striped">
            <thead>
              <tr>
                <th>Title</th>
                <th>Content</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="news-tbody"></tbody>
          </table>
          </div>
          <div class="row mb-3">
            <div class="col"><input id="news-title-add" class="form-control" placeholder="Title"></div>
            <div class="col"><input id="news-content-add" class="form-control" placeholder="Content"></div>
            <div class="col"></div>
            <div class="col-auto"><button onclick="addItem('news')" class="btn btn-success"><i class="bi bi-plus-circle"></i></button></div>
          </div>
          <!-- FAQ Section -->
          <h2>FAQ</h2>
          <div class="table-responsive">
  <table id="faq-table" class="table table-striped">
            <thead>
              <tr>
                <th>Title</th>
                <th>Content</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="faq-tbody"></tbody>
          </table>
          </div>
          <div class="row mb-3">
            <div class="col"><input id="faq-title-add" class="form-control" placeholder="Title"></div>
            <div class="col"><input id="faq-content-add" class="form-control" placeholder="Content"></div>
            <div class="col"></div>
            <div class="col-auto"><button onclick="addItem('faq')" class="btn btn-success"><i class="bi bi-plus-circle"></i></button></div>
          </div>
          <!-- Forms Section -->
          <h2>Forms<span class="ms-2" data-bs-toggle="tooltip" data-bs-title="Supports PDF and Excel (.xls, .xlsx) files"><i class="bi bi-question-circle" style="font-size: 0.8rem; color: black;"></i></span></h2>
          <div class="table-responsive">
           <table id="forms-table" class="table table-striped">
            <thead>
              <tr>
                <th>Title</th>
                <th>Content</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="forms-tbody"></tbody>
          </table>
          </div>
          <div class="row mb-3">
            <div class="col"><input id="forms-title-add" class="form-control" placeholder="Title"></div>
            <div class="col"><input id="forms-content-add" class="form-control" placeholder="Content"></div>
            <div class="col"><input id="forms-file-add" type="file" class="form-control"></div>
            <div class="col"></div>
            <div class="col-auto"><button onclick="addItem('forms')" class="btn btn-success"><i class="bi bi-plus-circle"></i></button></div>
          </div>
        </div>
        <div id="classes-tab" class="tab-content">
          <!-- Classes Section -->
          <h2>Classes</h2>
          <div class="table-responsive">
  <table id="classes-table" class="table table-striped">
            <thead>
              <tr>
                <th>Title</th>
                <th>Content</th>
                <th>Active</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="classes-tbody"></tbody>
          </table>
          </div>
          <div class="row mb-3">
            <div class="col"><input id="classes-title-add" class="form-control" placeholder="Title"></div>
            <div class="col"><input id="classes-content-add" class="form-control" placeholder="Content"></div>
            <div class="col-auto">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="classes-active-add">
                <label class="form-check-label" for="classes-active-add">Active</label>
              </div>
            </div>
            <div class="col"></div>
            <div class="col-auto"><button onclick="addItem('classes')" class="btn btn-success"><i class="bi bi-plus-circle"></i></button></div>
          </div>
          <h2>Rosters</h2>
          <div class="row">
            ${classesData.filter(c => c.active).map(c => `
              <div class="col-12 mb-3">
                <div class="card">
                  <div class="card-header"><strong>Roster for ${c.title}</strong></div>
                  <div class="card-body">
                    ${c.roster.length > 0 ? `
                      <table class="table table-striped">
                        <thead>
                          <tr>
                            <th>First Name</th>
                            <th>Last Name</th>
                            <th>Email</th>
                            <th>Signup Date</th>
                            <th>Actions</th>
 </tr>
                        </thead>
                        <tbody>
                          ${c.roster.map((r, index) => `
                            <tr>
                              <td>${r.firstName}</td>
                              <td>${r.lastName}</td>
                              <td>${r.email}</td>
                              <td>${formatter.format(new Date(r.date))}</td>
                              <td><button class="btn btn-danger btn-sm" onclick="deleteRosterEntry('${c._id}', ${index})"><i class="bi bi-trash"></i></button></td>
  </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    ` : '<p>No signups yet.</p>'}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div id="analytics-tab" class="tab-content">
          <h2>Analytics</h2>
          <p>Coming soon...</p>
        </div>
        <button onclick="saveData()" class="btn btn-primary mt-3"><i class="bi bi-save"></i> Save Changes</button>
        <a href="/" class="btn btn-secondary mt-3"><i class="bi bi-arrow-left-circle"></i> Go to Main</a>
        <a href="/logout" class="btn btn-danger mt-3"><i class="bi bi-box-arrow-right"></i> Logout</a>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      <script>
        var initialData = {
          news: ${JSON.stringify(newsData)},
          faq: ${JSON.stringify(faqData)},
          forms: ${JSON.stringify(formsData)},
          classes: ${JSON.stringify(classesData)},
          alert: ${JSON.stringify(alertData)}
        };
        var localData = JSON.parse(JSON.stringify(initialData));
        var editingRow = null; // Track currently editing row
        function updateTable(section) {
          var tbody = document.getElementById(section + '-tbody');
          tbody.innerHTML = '';
          localData[section].forEach((item, index) => {
            var row = document.createElement('tr');
            row.draggable = true;
            row.dataset.index = index;
            row.dataset.section = section;
            row.dataset.id = item._id;
            if (section === 'classes') {
              row.innerHTML = \`
                <td>\${item.title}</td>
                <td>\${item.content}</td>
                <td>\${item.active ? 'Yes' : 'No'}</td>
                <td>\${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.lastUpdated))}</td>
                <td>
                  <button onclick="editRow(this)" class="btn btn-primary btn-sm"><i class="bi bi-pencil"></i></button>
                  <button onclick="removeItem('\${section}', '\${item._id}')" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
                </td>
              \`;
            } else if (section === 'forms') {
              row.innerHTML = \`
                <td>\${item.title}</td>
                <td>\${item.content}</td>
                <td>\${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.lastUpdated))}</td>
                <td>
                  <button onclick="editRow(this)" class="btn btn-primary btn-sm"><i class="bi bi-pencil"></i></button>
                  <button onclick="removeItem('\${section}', '\${item._id}')" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
                </td>
              \`;
            } else {
              row.innerHTML = \`
                <td>\${item.title}</td>
                <td>\${item.content}</td>
                <td>\${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.lastUpdated))}</td>
                <td>
                  <button onclick="editRow(this)" class="btn btn-primary btn-sm"><i class="bi bi-pencil"></i></button>
                  <button onclick="removeItem('\${section}', '\${item._id}')" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
                </td>
              \`;
            }
            tbody.appendChild(row);
          });
          addDragListeners(section);
        }
        function addDragListeners(section) {
          var tbody = document.getElementById(section + '-tbody');
          tbody.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', e.target.dataset.index + ',' + e.target.dataset.section);
            e.target.classList.add('dragging');
          });
          tbody.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging');
            if (dragging && dragging.parentNode === tbody) {
              const afterElement = getDragAfterElement(tbody, e.clientY);
              if (afterElement == null) {
                tbody.appendChild(dragging);
              } else {
                tbody.insertBefore(dragging, afterElement);
              }
            }
          });
          tbody.addEventListener('drop', (e) => {
            e.preventDefault();
            const [fromIndex, fromSection] = e.dataTransfer.getData('text/plain').split(',');
            if (fromSection !== section) return;
            const rows = Array.from(tbody.children);
            const newOrder = rows.map(row => localData[section][row.dataset.index]._id);
            fetch('/reorder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ section, order: newOrder })
            }).then(() => {
              localData[section] = rows.map(row => localData[section][row.dataset.index]);
              updateTable(section);
            });
          });
          tbody.addEventListener('dragend', (e) => {
            e.target.classList.remove('dragging');
          });
        }
        function getDragAfterElement(container, y) {
          const draggableElements = [...container.querySelectorAll('tr:not(.dragging)')];
          return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
              return { offset: offset, element: child };
            } else {
              return closest;
            }
          }, { offset: Number.NEGATIVE_INFINITY }).element;
        }
        function editRow(button) {
          if (editingRow) return; // Only one edit at a time
          var row = button.parentNode.parentNode;
          editingRow = row;
          var cells = row.cells;
          var section = row.dataset.section;
          var index = parseInt(row.dataset.index);
          var item = localData[section][index];
          cells[0].innerHTML = \`<input type="text" value="\${item.title}" class="form-control">\`;
          cells[1].innerHTML = \`<input type="text" value="\${item.content}" class="form-control">\`;
          if (section === 'classes') {
            cells[2].innerHTML = \`<div class="form-check form-switch"><input class="form-check-input" type="checkbox" \${item.active ? 'checked' : ''}></div>\`;
            cells[3].innerHTML = \`\${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.lastUpdated))}\`;
            cells[4].innerHTML = \`
              <button onclick="saveEdit(this)" class="btn btn-success btn-sm"><i class="bi bi-check-circle"></i></button>
              <button onclick="cancelEdit(this)" class="btn btn-secondary btn-sm"><i class="bi bi-x-circle"></i></button>
              <button onclick="removeItem('\${section}', '\${item._id}')" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
            \`;
          } else {
            // Last updated remains
            cells[3].innerHTML = \`
              <button onclick="saveEdit(this)" class="btn btn-success btn-sm"><i class="bi bi-check-circle"></i></button>
              <button onclick="cancelEdit(this)" class="btn btn-secondary btn-sm"><i class="bi bi-x-circle"></i></button>
              <button onclick="removeItem('\${section}', '\${item._id}')" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
            \`;
          }
          row.draggable = false; // Disable drag while editing
        }
        function saveEdit(button) {
          var row = button.parentNode.parentNode;
          var section = row.dataset.section;
          var id = row.dataset.id;
          var titleInput = row.cells[0].querySelector('input');
          var contentInput = row.cells[1].querySelector('input');
          var updateData = {
            title: titleInput.value.trim(),
            content: contentInput.value.trim(),
            lastUpdated: new Date().toISOString()
          };
          if (section === 'classes') {
            var activeInput = row.cells[2].querySelector('input');
            updateData.active = activeInput.checked;
          }
          fetch('/update-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, id, updateData })
          }).then(response => {
            if (response.ok) {
              location.reload(); // Reload to refresh localData
            } else {
              alert('Error saving edit');
            }
          });
        }
        function cancelEdit(button) {
          var row = button.parentNode.parentNode;
          var section = row.dataset.section;
          editingRow = null;
          updateTable(section);
        }
        function deleteRosterEntry(classId, rosterIndex) {
  if (confirm('Delete this roster entry?')) {
    const classIndex = localData.classes.findIndex(c => c._id === classId);
    if (classIndex !== -1) {
      const updatedRoster = [...localData.classes[classIndex].roster];
      updatedRoster.splice(rosterIndex, 1);
      const updateData = { roster: updatedRoster };
      fetch('/update-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'classes', id: classId, updateData })
      }).then(response => {
        if (response.ok) {
          localData.classes[classIndex].roster = updatedRoster;
          alert('Roster entry deleted!');
          location.reload(); // Or dynamically update table without reload if preferred
        } else {
          alert('Delete failed');
        }
      }).catch(err => {
        console.error('Error deleting roster entry:', err);
        alert('Error deleting');
      });
    }
  }
}
function addItem(section) {
          if (section === 'forms') {
            var title = document.getElementById('forms-title-add').value.trim();
            var content = document.getElementById('forms-content-add').value.trim();
            var fileInput = document.getElementById('forms-file-add');
            if (title && content && fileInput.files[0]) {
              var formData = new FormData();
              formData.append('title', title);
              formData.append('content', content);
              formData.append('formFile', fileInput.files[0]);
              fetch('/upload-form', {
                method: 'POST',
                body: formData
              }).then(response => response.json()).then(newItem => {
                localData.forms.push(newItem);
                updateTable('forms');
                document.getElementById('forms-title-add').value = '';
                document.getElementById('forms-content-add').value = '';
                fileInput.value = '';
              }).catch(err => alert('Error uploading form'));
              return;
            } else {
              alert('All fields and file required for forms');
              return;
            }
          } else if (section === 'classes') {
            var titleInput = document.getElementById(section + '-title-add');
            var contentInput = document.getElementById(section + '-content-add');
            var activeInput = document.getElementById(section + '-active-add');
            if (titleInput.value.trim() && contentInput.value.trim()) {
              const newItem = {
                title: titleInput.value.trim(),
                content: contentInput.value.trim(),
                lastUpdated: new Date().toISOString(),
                active: activeInput.checked,
                roster: []
              };
              fetch('/add-item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ section, newItem })
              }).then(response => {
                if (response.ok) {
                  location.reload();
                } else {
                  alert('Error adding item');
                }
              });
            }
            return;
          }
          // Original add for other sections
          var titleInput = document.getElementById(section + '-title-add');
          var contentInput = document.getElementById(section + '-content-add');
          if (titleInput.value.trim() && contentInput.value.trim()) {
            const newItem = {
              title: titleInput.value.trim(),
              content: contentInput.value.trim(),
              lastUpdated: new Date().toISOString()
            };
            fetch('/add-item', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ section, newItem })
            }).then(response => {
              if (response.ok) {
                location.reload();
              } else {
                alert('Error adding item');
              }
            });
          }
        }
        function removeItem(section, id) {
          fetch('/delete-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, id })
          }).then(response => {
            if (response.ok) {
              location.reload();
            } else {
              alert('Error deleting item');
            }
          });
        }
        function updateAlertActive() {
          const enableTitle = document.getElementById('alert-enable-title').checked;
          const enableContent = document.getElementById('alert-enable-content').checked;
          const activeSwitch = document.getElementById('alert-active');
          const titleSwitchDiv = document.getElementById('alert-title-switch');
          const contentSwitchDiv = document.getElementById('alert-content-switch');
          if (!enableTitle && !enableContent) {
            activeSwitch.checked = false;
            activeSwitch.disabled = true;
          } else {
            activeSwitch.disabled = false;
            if (!activeSwitch.checked) {
              activeSwitch.checked = true;
            }
          }
          if (!activeSwitch.checked) {
            titleSwitchDiv.classList.add('dimmed');
            contentSwitchDiv.classList.add('dimmed');
          } else {
            titleSwitchDiv.classList.remove('dimmed');
            contentSwitchDiv.classList.remove('dimmed');
          }
        }
        function saveData() {
          const alertUpdate = {
            title: document.getElementById('alert-title').value.trim(),
            content: document.getElementById('alert-content').value.trim(),
            color: document.getElementById('alert-color').value,
            orientation: document.getElementById('alert-orientation').value,
            enableTitle: document.getElementById('alert-enable-title').checked,
            enableContent: document.getElementById('alert-enable-content').checked,
            active: document.getElementById('alert-active').checked
          };
          fetch('/save-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alertUpdate)
          }).then(response => {
            if (response.ok) {
              alert('Changes saved!');
            } else {
              alert('Error saving changes.');
            }
          });
        }
        function showTab(tab) {
          document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
          document.getElementById(tab + '-tab').classList.add('active');
          const collapse = document.querySelector('.navbar-collapse');
          if (collapse.classList.contains('show')) {
            new bootstrap.Collapse(collapse).hide();
          }
        }
        // Initialize tables
        updateTable('news');
        updateTable('faq');
        updateTable('forms');
        updateTable('classes');
        var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
        var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
          return new bootstrap.Tooltip(tooltipTriggerEl)
        })
        document.getElementById('alert-enable-title').addEventListener('change', updateAlertActive);
        document.getElementById('alert-enable-content').addEventListener('change', updateAlertActive);
        document.getElementById('alert-active').addEventListener('change', updateAlertActive);
        document.getElementById('copyright-year').textContent = new Date().getFullYear();
updateAlertActive();
      </script>
        </body>
<footer>
</footer>
    </html>
  `;
    res.send(html);
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    res.status(500).send('Server error');
  }
});
// Add item endpoint
app.post('/add-item', isAuthenticated, async (req, res) => {
  const { section, newItem } = req.body;
  try {
    let model;
    switch (section) {
      case 'news':
        model = News;
        break;
      case 'faq':
        model = Faq;
        break;
      case 'classes':
        model = Class;
        break;
      default:
        return res.status(400).send('Invalid section');
    }
    const created = await model.create(newItem);
    console.log(`Added item to ${section}:`, created._id);
    res.send('OK');
  } catch (err) {
    console.error('Error adding item:', err);
    res.status(500).send('Error');
  }
});
// Update item endpoint
app.post('/update-item', isAuthenticated, async (req, res) => {
  const { section, id, updateData } = req.body;
  try {
    let model;
    switch (section) {
      case 'news':
        model = News;
        break;
      case 'faq':
        model = Faq;
        break;
      case 'forms':
        model = Form;
        break;
      case 'classes':
        model = Class;
        break;
      default:
        return res.status(400).send('Invalid section');
    }
    const updated = await model.findByIdAndUpdate(id, updateData, { new: true });
    console.log(`Updated item in ${section}:`, id);
    res.send('OK');
  } catch (err) {
    console.error('Error updating item:', err);
    res.status(500).send('Error');
  }
});
// Delete item endpoint
app.post('/delete-item', isAuthenticated, async (req, res) => {
  const { section, id } = req.body;
  try {
    let model;
    switch (section) {
      case 'news':
        model = News;
        break;
      case 'faq':
        model = Faq;
        break;
      case 'forms':
  model = Form;
  const form = await Form.findById(id);
  if (form && form.filename) {
    const filePath = path.join(__dirname, 'uploads/forms', form.filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Deleted file:', form.filename);
      } else {
        console.log('File not found for deletion:', form.filename);
      }
    } catch (unlinkErr) {
      console.error('Error deleting file:', unlinkErr);
    }
        }
        break;
      case 'classes':
        model = Class;
        break;
      default:
        return res.status(400).send('Invalid section');
    }
    await model.findByIdAndDelete(id);
    console.log(`Deleted item from ${section}:`, id);
    res.send('OK');
  } catch (err) {
    console.error('Error deleting item:', err);
    res.status(500).send('Error');
  }
});
// Reorder endpoint (for drag-drop)
app.post('/reorder', isAuthenticated, async (req, res) => {
  const { section, order } = req.body;
  try {
    let model;
    switch (section) {
      case 'news':
        model = News;
        break;
      case 'faq':
        model = Faq;
        break;
      case 'forms':
        model = Form;
        break;
      case 'classes':
        model = Class;
        break;
      default:
        return res.status(400).send('Invalid section');
    }
    // For simplicity, since no order field, we can add an order field to schema if needed, but for now assume client handles
    // To properly reorder, add order: Number to schemas and update here
    // For now, skip actual DB reorder as it's not persisted; client reloads anyway
    res.send('OK');
  } catch (err) {
    console.error('Error reordering:', err);
    res.status(500).send('Error');
  }
});
// Save alert endpoint
app.post('/save-alert', isAuthenticated, async (req, res) => {
  try {
    const update = req.body;
    let alert = await Alert.findOne();
    if (!alert) {
      alert = new Alert(update);
      await alert.save();
    } else {
      await Alert.updateOne({}, update);
    }
    console.log('Saved alert');
    res.send('OK');
  } catch (err) {
    console.error('Error saving alert:', err);
    res.status(500).send('Error');
  }
});
// Upload form endpoint
app.post('/upload-form', isAuthenticated, (req, res) => {
  upload.single('formFile')(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const newItem = {
        title: req.body.title,
        content: req.body.content,
        lastUpdated: new Date(),
        filename: req.file.filename
      };
      const created = await Form.create(newItem);
      console.log('Uploaded form:', created._id);
      res.json(created);
    } catch (e) {
      console.error('Upload failed:', e);
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
});
// Delete file endpoint (called in delete-item for forms)
app.post('/delete-file', isAuthenticated, (req, res) => {
  const { filename } = req.body;
  const filePath = path.join(__dirname, 'uploads/forms', filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('Deleted file:', filename);
  }
  res.send('OK');
});
// Check verified endpoint
app.get('/check-verified', (req, res) => {
  res.json({ verified: req.session.captchaVerified || req.session.authenticated });
});
// Verify CAPTCHA endpoint
app.post('/verify-captcha', (req, res) => {
  const token = req.body.token;
  const secret = '6LdrqpwrAAAAALl15L_kXI60l8IvkPgTlZtAOh_3'; // Replace with real
  fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        req.session.captchaVerified = true;
        res.send('OK');
      } else {
        res.status(400).send('CAPTCHA failed');
      }
    });
});
// Signup endpoint
app.post('/signup', async (req, res) => {
  const { firstName, lastName, email, classId } = req.body;
  try {
    const classItem = await Class.findById(classId);
    if (classItem) {
      classItem.roster.push({ firstName, lastName, email, date: new Date() });
      await classItem.save();
      console.log('Added signup to class:', classId);
      res.send('OK');
    } else {
      res.status(404).send('Class not found');
    }
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('Error');
  }
});
// Send contact email
app.post('/send-contact', upload.none(), async (req, res) => {
  console.log('Received form data:', req.body);
  const { firstName, lastName, email, phone, message } = req.body;
  if (!firstName || !lastName || !email || !phone) {
    console.log('Missing fields:', { firstName, lastName, email, phone });
    return res.status(400).send('Required fields missing');
  }
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  let mailOptions = {
    from: email,
    to: 'help@jandtaccounting.com',
    subject: `Contact from ${firstName} ${lastName}`,
    text: `Name: ${firstName} ${lastName}\nEmail: ${email}\nPhone: ${phone}\nMessage: ${message || 'No message provided'}`,
    html: `<p><strong>Name:</strong> ${firstName} ${lastName}</p>
           <p><strong>Email:</strong> ${email}</p>
           <p><strong>Phone:</strong> ${phone}</p>
           <p><strong>Message:</strong> ${message || 'No message provided'}</p>`
  };
  try {
    let info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ' + info.response);
    res.send('OK');
  } catch (err) {
    console.error('Error sending email: ', err);
    res.status(500).send('Error sending email');
  }
});
// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/schwertfisch');
});
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
