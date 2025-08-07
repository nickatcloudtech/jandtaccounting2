require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const multer = require('multer');
const path = require('path');
const app = express();
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
const dataFile = 'data.json';
let data = {
  news: [
    { title: 'Default News Title', content: 'Default news content', editableDate: '2023-01-01', lastUpdated: new Date().toISOString() }
  ],
  faq: [
    { title: 'Default FAQ Title', content: 'Default FAQ content', editableDate: '2023-01-01', lastUpdated: new Date().toISOString() }
  ],
  forms: [], // Removed dummy data
  classes: [
    { title: 'Default Class Title', content: 'Default class content', editableDate: '2023-01-01', lastUpdated: new Date().toISOString() }
  ]
};
if (fs.existsSync(dataFile)) {
  let loadedData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  // Migrate if old format (no title)
  Object.keys(loadedData).forEach(key => {
    loadedData[key] = loadedData[key].map(item => {
      if (!item.title) {
        return {
          title: 'Untitled',
          content: item.content || 'Default content',
          editableDate: item.editableDate || new Date().toISOString().split('T')[0],
          lastUpdated: item.lastUpdated || new Date().toISOString(),
          filename: item.filename || '' // Add filename if missing
        };
      }
      return item;
    });
  });
  data = loadedData;
  if (!data.news) data.news = [];
  if (!data.faq) data.faq = [];
  if (!data.forms) data.forms = [];
  if (!data.classes) data.classes = [];
} else {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}
// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }
  res.redirect('/schwertfisch');
}
// Main page: Renders data as stacked cards with Bootstrap
app.get('/', (req, res) => {
  const formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Main Website</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Open Sans', sans-serif; background-color: #f8f9fa; color: #333; }
body { padding-top: 70px; }
        .navbar { background-color: #001f3f; }
        .navbar-brand { color: #ffd700; font-weight: 700; font-size: 1.5rem; }
        .nav-link { color: white; font-weight: 600; }
        .btn-contact { background-color: #ffd700; border-color: #ffd700; color: #001f3f; border-radius: 20px; font-weight: 600; }
        .hero { background-color: #e9ecef; padding: 4rem 0; text-align: center; color: #fff; background-image: linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url('https://images.pexels.com/photos/2356045/pexels-photo-2356045.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1'); background-size: cover; }
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
@media (max-width: 576px) {
  .card-body { padding: 1rem; font-size: 1rem; }
  .hero h1 { font-size: 2rem; }
  .description { font-size: 1rem; padding: 1rem 0; }
  .btn { font-size: 1rem; }
}
@media (max-width: 991px) {
  .navbar-collapse {
    position: relative;
    height: auto !important;
    background-color: #001f3f; /* Matches navbar bg for consistency */
  }
}
      </style>
      <script src="https://www.google.com/recaptcha/api.js" async defer></script>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="#">J & T Accounting</a>
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
              <li class="nav-item"><a class="nav-link" href="#" onclick="showSection('taxdome')">TaxDome</a></li>
              <li class="nav-item"><button class="btn btn-contact ms-2">Free Consultation</button></li>
            </ul>
          </div>
        </div>
      </nav>
     
      <div id="home" class="section active container mt-4">
        <div class="hero">
          <h1>Supporting you & your growing business.</h1>
        </div>
        <img style="width: 100px; height: 100px; border-radius: 50%; display: block; margin: 2rem auto;" src="https://images.pexels.com/photos/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1" alt="Team Photo">
        <div class="description">
          J & T Accounting provides financial guidance for businesses through planning and ongoing advisement. We also support individuals with personal accounting and tax needs. Our approach is focused on establishing relationships with our clients, so we have a vested interest in helping them achieve their strategic goals.
        </div>
        <div class="icons">
          <i class="bi bi-briefcase-fill icon"></i>
          <i class="bi bi-file-earmark-text-fill icon"></i>
          <i class="bi bi-graph-up-arrow icon"></i>
        </div>
      </div>
     
      <div id="about" class="section container mt-4">
        <h2>About</h2>
        <p>Placeholder for About section. Edit in dashboard if needed.</p>
      </div>
     
      <div id="services" class="section container mt-4">
        <h2>Services</h2>
        <p>Placeholder for Services section. Edit in dashboard if needed.</p>
      </div>
     
      <div id="classes" class="section container mt-4">
        <h2>Classes</h2>
        <div class="row">
          ${data.classes ? data.classes.map(c => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${c.title}</strong></div>
                <div class="card-body">
                  ${c.content}
                  <p class="mt-2 text-muted">Date: ${c.editableDate}</p>
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
          ${data.forms ? data.forms.map(f => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${f.title}</strong></div>
                <div class="card-body">
                  ${f.content}
                  <p class="mt-2 text-muted">Date: ${f.editableDate}</p>
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
          ${data.news ? data.news.map(n => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${n.title}</strong></div>
                <div class="card-body">
                  ${n.content}
                  <p class="mt-2 text-muted">Date: ${n.editableDate}</p>
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
        <div class="row">
          ${data.faq ? data.faq.map(f => `
            <div class="col-12 mb-3">
              <div class="card">
                <div class="card-header"><strong>${f.title}</strong></div>
                <div class="card-body">
                  ${f.content}
                  <p class="mt-2 text-muted">Date: ${f.editableDate}</p>
                </div>
                <div class="card-footer text-muted">
                  <small><i><strong>Last Updated: <span class="local-datetime" data-iso="${f.lastUpdated}">${formatter.format(new Date(f.lastUpdated))}</span></strong></i></small>
                </div>
              </div>
            </div>
          `).join('') : ''}
        </div>
      </div>
     
      <div id="contact" class="section container mt-4">
        <h2>Contact</h2>
        <p>Placeholder for Contact section. Edit in dashboard if needed.</p>
      </div>
     
      <div id="irs" class="section container mt-4">
        <h2>IRS</h2>
        <p>Placeholder for IRS section. Edit in dashboard if needed.</p>
      </div>
     
      <div id="taxdome" class="section container mt-4">
        <h2>TaxDome</h2>
        <p>Placeholder for TaxDome section. Edit in dashboard if needed.</p>
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
     
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      <script>
        let downloadUrl = '';
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
       function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  // New: Close navbar collapse on mobile after click
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
      </script>
    </body>
    </html>
  `;
  res.send(html);
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
app.get('/dashboard', isAuthenticated, (req, res) => {
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
body { font-family: 'Open Sans', sans-serif; background-color: #f8f9fa; color: #333; }
        .table { background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .btn-success { background-color: #8fb98b; border-color: #8fb98b; border-radius: 20px; font-weight: 600; color: white; }
        .btn-primary { background-color: #001f3f; border-color: #001f3f; border-radius: 20px; font-weight: 600; color: white; }
        .btn-danger { background-color: #dc3545; border-color: #dc3545; border-radius: 20px; font-weight: 600; color: white; }
        .btn-secondary { background-color: #6c757d; border-color: #6c757d; border-radius: 20px; font-weight: 600; color: white; }
        tbody tr:hover { cursor: grab; background-color: #e9ecef; }
        .editing input { width: 100%; }
        h1, h2 { color: #001f3f; font-weight: 700; }
        .bi { font-weight: bold; font-size: 1.2rem; } // Bold icons
@media (max-width: 576px) {
  .form-control { font-size: 1rem; }
  .btn-sm { font-size: 0.875rem; }
  h2 { font-size: 1.5rem; }
}
      </style>
    </head>
    <body class="container mt-4">
      <h1>Dashboard</h1>
     
      <!-- News Section -->
      <h2>News</h2>
      <div class="table-responsive">
<table id="news-table" class="table table-striped">
        <thead>
          <tr>
            <th>Title</th>
            <th>Content</th>
            <th>Editable Date</th>
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
        <div class="col"><input id="news-date-add" type="date" class="form-control"></div>
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
            <th>Editable Date</th>
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
        <div class="col"><input id="faq-date-add" type="date" class="form-control"></div>
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
            <th>Editable Date</th>
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
        <div class="col"><input id="forms-date-add" type="date" class="form-control"></div>
        <div class="col"><input id="forms-file-add" type="file" class="form-control"></div>
        <div class="col"></div>
        <div class="col-auto"><button onclick="addItem('forms')" class="btn btn-success"><i class="bi bi-plus-circle"></i></button></div>
      </div>
     
      <!-- Classes Section -->
      <h2>Classes</h2>
      <div class="table-responsive">
<table id="classes-table" class="table table-striped">
        <thead>
          <tr>
            <th>Title</th>
            <th>Content</th>
            <th>Editable Date</th>
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
        <div class="col"><input id="classes-date-add" type="date" class="form-control"></div>
        <div class="col"></div>
        <div class="col-auto"><button onclick="addItem('classes')" class="btn btn-success"><i class="bi bi-plus-circle"></i></button></div>
      </div>
     
      <button onclick="saveData()" class="btn btn-primary mt-3"><i class="bi bi-save"></i> Save Changes</button>
      <a href="/" class="btn btn-secondary mt-3"><i class="bi bi-arrow-left-circle"></i> Go to Main</a>
      <a href="/logout" class="btn btn-danger mt-3"><i class="bi bi-box-arrow-right"></i> Logout</a>
     
      <script>
        var initialData = ${JSON.stringify(data)};
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
            row.innerHTML = \`
              <td>\${item.title}</td>
              <td>\${item.content}</td>
              <td><input type="date" value="\${item.editableDate}" onchange="updateDate('\${section}', \${index}, this.value)"></td>
      <td>\${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.lastUpdated))}</td>
              <td>
                <button onclick="editRow(this)" class="btn btn-primary btn-sm"><i class="bi bi-pencil"></i></button>
                <button onclick="removeItem('\${section}', \${index})" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
              </td>
            \`;
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
            const newOrder = rows.map(row => parseInt(row.dataset.index));
            const newData = newOrder.map(idx => localData[section][idx]);
            localData[section] = newData;
            updateTable(section);
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
          // Date remains input
          // Last updated remains
          cells[4].innerHTML = \`
            <button onclick="saveEdit(this)" class="btn btn-success btn-sm"><i class="bi bi-check-circle"></i></button>
            <button onclick="cancelEdit(this)" class="btn btn-secondary btn-sm"><i class="bi bi-x-circle"></i></button>
            <button onclick="removeItem('\${section}', \${index})" class="btn btn-danger btn-sm"><i class="bi bi-trash"></i></button>
          \`;
          row.draggable = false; // Disable drag while editing
        }
        function saveEdit(button) {
          var row = button.parentNode.parentNode;
          var section = row.dataset.section;
          var index = parseInt(row.dataset.index);
          var titleInput = row.cells[0].querySelector('input');
          var contentInput = row.cells[1].querySelector('input');
          var dateInput = row.cells[2].querySelector('input');
          localData[section][index].title = titleInput.value.trim();
          localData[section][index].content = contentInput.value.trim();
          localData[section][index].editableDate = dateInput.value;
          localData[section][index].lastUpdated = new Date().toISOString();
          editingRow = null;
          updateTable(section);
        }
        function cancelEdit(button) {
          var row = button.parentNode.parentNode;
          var section = row.dataset.section;
          editingRow = null;
          updateTable(section);
        }
        function updateDate(section, index, value) {
          localData[section][index].editableDate = value;
          localData[section][index].lastUpdated = new Date().toISOString();
        }
        function addItem(section) {
          if (section === 'forms') {
            var title = document.getElementById('forms-title-add').value.trim();
            var content = document.getElementById('forms-content-add').value.trim();
            var date = document.getElementById('forms-date-add').value;
            var fileInput = document.getElementById('forms-file-add');
            if (title && content && date && fileInput.files[0]) {
              var formData = new FormData();
              formData.append('title', title);
              formData.append('content', content);
              formData.append('editableDate', date);
              formData.append('formFile', fileInput.files[0]);
              fetch('/upload-form', {
                method: 'POST',
                body: formData
              }).then(response => response.json()).then(newItem => {
                localData.forms.push(newItem);
                updateTable('forms');
                document.getElementById('forms-title-add').value = '';
                document.getElementById('forms-content-add').value = '';
                document.getElementById('forms-date-add').value = '';
                fileInput.value = '';
              }).catch(err => alert('Error uploading form'));
              return;
            } else {
              alert('All fields and file required for forms');
              return;
            }
          }
          // Original add for other sections
          var titleInput = document.getElementById(section + '-title-add');
          var contentInput = document.getElementById(section + '-content-add');
          var dateInput = document.getElementById(section + '-date-add');
          if (titleInput.value.trim() && contentInput.value.trim() && dateInput.value) {
            localData[section].push({
              title: titleInput.value.trim(),
              content: contentInput.value.trim(),
              editableDate: dateInput.value,
              lastUpdated: new Date().toISOString()
            });
            titleInput.value = '';
            contentInput.value = '';
            dateInput.value = '';
            updateTable(section);
          }
        }
        function removeItem(section, index) {
          const item = localData[section][index];
          localData[section].splice(index, 1);
          updateTable(section);
          if (section === 'forms' && item.filename) {
            fetch('/delete-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: item.filename })
            });
          }
        }
        function saveData() {
          fetch('/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localData)
          }).then(response => {
            if (response.ok) {
              alert('Changes saved!');
            } else {
              alert('Error saving changes.');
            }
          });
        }
        // Initialize tables
        updateTable('news');
        updateTable('faq');
        updateTable('forms');
        if (localData.classes) updateTable('classes');
        var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
        var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
          return new bootstrap.Tooltip(tooltipTriggerEl)
        })
      </script>
    </body>
    </html>
  `;
  res.send(html);
});
// Upload form endpoint
app.post('/upload-form', isAuthenticated, (req, res) => {
  upload.single('formFile')(req, res, function (err) {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const newItem = {
        title: req.body.title,
        content: req.body.content,
        editableDate: req.body.editableDate,
        lastUpdated: new Date().toISOString(),
        filename: req.file.filename
      };
      data.forms.push(newItem);
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
      res.json(newItem);
    } catch (e) {
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
});
// Delete file endpoint
app.post('/delete-file', isAuthenticated, (req, res) => {
  const { filename } = req.body;
  const filePath = path.join(__dirname, 'uploads/forms', filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  res.send('OK');
});
// Check verified endpoint
app.get('/check-verified', (req, res) => {
  res.json({ verified: req.session.captchaVerified || req.session.authenticated });
});
// Verify CAPTCHA endpoint (client sends token, server verifies)
app.post('/verify-captcha', (req, res) => {
  const token = req.body.token;
  const secret = '6LdrqpwrAAAAALl15L_kXI60l8IvkPgTlZtAOh_3'; // Replace with your secret key
  fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        req.session.captchaVerified = true; // Set session flag
        res.send('OK');
      } else {
        res.status(400).send('CAPTCHA failed');
      }
    });
});
// Save endpoint
app.post('/save', isAuthenticated, (req, res) => {
  data = req.body;
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  res.send('OK');
});
// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/schwertfisch');
});
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
