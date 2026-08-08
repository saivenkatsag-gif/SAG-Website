// ═══════════════════════════════════════════════════════════════════
//  SAG Reviews Widget — login-free star ratings + reviews
//
//  USAGE
//  Drop this on any page and add one or more containers:
//
//    <div class="sag-reviews"
//         data-target-type="course"
//         data-target-id="rpto-small-class"
//         data-target-name="Small Class Rotorcraft Training"
//         data-schema-id="courseSchema1"></div>
//    <script src="review-widget.js"></script>
//
//  - target-type / target-id / target-name: how the review is tagged
//    and what shows in the admin approval queue.
//  - schema-id (optional): the id of a <script type="application/
//    ld+json"> tag on the page whose JSON should get an
//    "aggregateRating" field injected once real approved reviews
//    exist. Works for Googlebot (which executes JS before reading
//    structured data) but not for non-JS crawlers — same trade-off
//    already accepted elsewhere on this site for client-rendered data.
//
//  No login is required to submit — every submission lands as
//  approved = false (enforced server-side by the RLS policy, not by
//  this script) and only shows up publicly once approved in
//  admin.html.
// ═══════════════════════════════════════════════════════════════════

(function () {
  var SUPABASE_URL = 'https://mefmpxohxrpnezwlbchj.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lZm1weG9oeHJwbmV6d2xiY2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTk3MjEsImV4cCI6MjA5Mjc5NTcyMX0.PbTag81xO1_X8vuxkizhVYjfhj3lz5CO3yjn8zlnNoM';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function starsHtml(rating, size) {
    var full = Math.round(rating);
    var html = '<span class="sag-rev-stars" style="font-size:' + (size || 16) + 'px;letter-spacing:1px;">';
    for (var i = 1; i <= 5; i++) {
      html += i <= full
        ? '<span style="color:#f0a030;">\u2605</span>'
        : '<span style="color:#d9e4f0;">\u2605</span>';
    }
    html += '</span>';
    return html;
  }

  async function fetchApprovedReviews(targetType, targetId) {
    var url = SUPABASE_URL + '/rest/v1/reviews' +
      '?target_type=eq.' + encodeURIComponent(targetType) +
      '&target_id=eq.' + encodeURIComponent(targetId) +
      '&approved=eq.true' +
      '&select=reviewer_name,rating,comment,created_at,verified_purchase' +
      '&order=created_at.desc';
    var res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    });
    if (!res.ok) return [];
    return await res.json();
  }

  // Fetch approved reviews for MANY target_ids in one request, and
  // return { targetId: { avg, count } } — used to populate compact
  // star ratings on a grid of product cards without one request per
  // card.
  async function fetchSummaries(targetType, targetIds) {
    if (!targetIds.length) return {};
    var idList = targetIds.map(function (id) { return encodeURIComponent(id); }).join(',');
    var url = SUPABASE_URL + '/rest/v1/reviews' +
      '?target_type=eq.' + encodeURIComponent(targetType) +
      '&target_id=in.(' + idList + ')' +
      '&approved=eq.true' +
      '&select=target_id,rating';
    var res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    });
    if (!res.ok) return {};
    var rows = await res.json();
    var byId = {};
    rows.forEach(function (r) {
      if (!byId[r.target_id]) byId[r.target_id] = { sum: 0, count: 0 };
      byId[r.target_id].sum += r.rating;
      byId[r.target_id].count += 1;
    });
    var out = {};
    Object.keys(byId).forEach(function (id) {
      out[id] = { avg: byId[id].sum / byId[id].count, count: byId[id].count };
    });
    return out;
  }

  async function submitReview(payload) {
    var res = await fetch(SUPABASE_URL + '/rest/v1/reviews', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      var err = await res.text();
      throw new Error('Submit failed: ' + err);
    }
  }

  function injectAggregateRating(schemaId, reviews) {
    if (!schemaId || !reviews.length) return;
    var el = document.getElementById(schemaId);
    if (!el) return;
    try {
      var data = JSON.parse(el.textContent);
      var sum = reviews.reduce(function (a, r) { return a + r.rating; }, 0);
      var avg = sum / reviews.length;
      data.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: avg.toFixed(1),
        reviewCount: reviews.length,
      };
      el.textContent = JSON.stringify(data);
    } catch (e) {
      // Malformed or missing schema block — skip silently rather than break the page.
    }
  }

  function renderWidget(container) {
    if (container.getAttribute('data-sag-rev-init') === '1') return;
    container.setAttribute('data-sag-rev-init', '1');

    var targetType = container.getAttribute('data-target-type') || 'company';
    var targetId = container.getAttribute('data-target-id') || 'company';
    var targetName = container.getAttribute('data-target-name') || 'SAG Drone Technologies';
    var schemaId = container.getAttribute('data-schema-id') || '';

    container.innerHTML =
      '<div class="sag-rev-wrap">' +
      '  <div class="sag-rev-summary" id="sagRevSummary-' + targetId + '">Loading reviews\u2026</div>' +
      '  <div class="sag-rev-list" id="sagRevList-' + targetId + '"></div>' +
      '  <button class="sag-rev-toggle" id="sagRevToggle-' + targetId + '">\u270D Write a Review</button>' +
      '  <form class="sag-rev-form" id="sagRevForm-' + targetId + '" style="display:none;">' +
      '    <div class="sag-rev-star-input" id="sagRevStarInput-' + targetId + '">' +
      [1, 2, 3, 4, 5].map(function (n) {
        return '<span data-val="' + n + '" class="sag-rev-star-pick">\u2605</span>';
      }).join('') +
      '    </div>' +
      '    <input type="text" class="sag-rev-name" id="sagRevName-' + targetId + '" placeholder="Your name" maxlength="80" required/>' +
      '    <textarea class="sag-rev-comment" id="sagRevComment-' + targetId + '" placeholder="Share your experience (optional)" maxlength="600"></textarea>' +
      '    <button type="submit" class="sag-rev-submit">Submit Review</button>' +
      '    <div class="sag-rev-msg" id="sagRevMsg-' + targetId + '"></div>' +
      '  </form>' +
      '</div>';

    var toggle = document.getElementById('sagRevToggle-' + targetId);
    var form = document.getElementById('sagRevForm-' + targetId);
    toggle.addEventListener('click', function () {
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    var selectedRating = 0;
    var starInput = document.getElementById('sagRevStarInput-' + targetId);
    starInput.querySelectorAll('.sag-rev-star-pick').forEach(function (star) {
      star.addEventListener('click', function () {
        selectedRating = parseInt(star.getAttribute('data-val'), 10);
        starInput.querySelectorAll('.sag-rev-star-pick').forEach(function (s) {
          s.style.color = parseInt(s.getAttribute('data-val'), 10) <= selectedRating ? '#f0a030' : '#d9e4f0';
        });
      });
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var msg = document.getElementById('sagRevMsg-' + targetId);
      var nameEl = document.getElementById('sagRevName-' + targetId);
      var commentEl = document.getElementById('sagRevComment-' + targetId);

      if (!selectedRating) {
        msg.textContent = 'Please select a star rating.';
        msg.style.color = '#c0392b';
        return;
      }
      if (!nameEl.value.trim()) {
        msg.textContent = 'Please enter your name.';
        msg.style.color = '#c0392b';
        return;
      }

      var submitBtn = form.querySelector('.sag-rev-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting\u2026';

      try {
        await submitReview({
          target_type: targetType,
          target_id: targetId,
          target_name: targetName,
          reviewer_name: nameEl.value.trim(),
          rating: selectedRating,
          comment: commentEl.value.trim() || null,
          approved: false,
        });
        msg.style.color = '#1a8a4a';
        msg.textContent = 'Thanks! Your review has been submitted and will appear here once approved.';
        form.reset();
        selectedRating = 0;
        starInput.querySelectorAll('.sag-rev-star-pick').forEach(function (s) { s.style.color = '#d9e4f0'; });
        submitBtn.textContent = 'Submit Review';
        setTimeout(function () { form.style.display = 'none'; }, 2500);
      } catch (err) {
        msg.style.color = '#c0392b';
        msg.textContent = 'Something went wrong — please try again in a moment.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Review';
      }
    });

    fetchApprovedReviews(targetType, targetId).then(function (reviews) {
      var summaryEl = document.getElementById('sagRevSummary-' + targetId);
      var listEl = document.getElementById('sagRevList-' + targetId);

      if (!reviews.length) {
        summaryEl.innerHTML = '<span style="color:var(--muted,#4a6885);font-size:0.9rem;">No reviews yet — be the first to share your experience.</span>';
        return;
      }

      var avg = reviews.reduce(function (a, r) { return a + r.rating; }, 0) / reviews.length;
      summaryEl.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;">' +
        starsHtml(avg, 20) +
        '<strong style="font-size:1.1rem;">' + avg.toFixed(1) + '</strong>' +
        '<span style="color:var(--muted,#4a6885);font-size:0.85rem;">(' + reviews.length + ' review' + (reviews.length === 1 ? '' : 's') + ')</span>' +
        '</div>';

      listEl.innerHTML = reviews.slice(0, 10).map(function (r) {
        return '<div class="sag-rev-item">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<strong>' + esc(r.reviewer_name) + '</strong>' +
          (r.verified_purchase ? '<span style="font-size:0.72rem;color:#1a8a4a;">\u2713 Verified</span>' : '') +
          '</div>' +
          starsHtml(r.rating, 13) +
          (r.comment ? '<p style="margin-top:4px;font-size:0.88rem;color:var(--text,#1a2940);">' + esc(r.comment) + '</p>' : '') +
          '</div>';
      }).join('');

      injectAggregateRating(schemaId, reviews);
    });
  }

  function injectStyles() {
    if (document.getElementById('sagRevStyles')) return;
    var style = document.createElement('style');
    style.id = 'sagRevStyles';
    style.textContent =
      '.sag-rev-wrap{font-family:inherit;}' +
      '.sag-rev-list{margin-top:14px;display:flex;flex-direction:column;gap:10px;}' +
      '.sag-rev-item{border:1px solid rgba(133,201,255,0.35);border-radius:10px;padding:12px 14px;background:#fff;}' +
      '.sag-rev-toggle{margin-top:14px;background:transparent;border:1.5px solid var(--blue,#1a6fb5);color:var(--blue,#1a6fb5);padding:9px 18px;border-radius:30px;font-weight:600;cursor:pointer;font-size:0.85rem;}' +
      '.sag-rev-toggle:hover{background:var(--blue,#1a6fb5);color:#fff;}' +
      '.sag-rev-form{margin-top:14px;display:flex;flex-direction:column;gap:10px;max-width:420px;}' +
      '.sag-rev-star-input{font-size:26px;letter-spacing:4px;cursor:pointer;}' +
      '.sag-rev-star-pick{color:#d9e4f0;transition:color .15s;}' +
      '.sag-rev-name,.sag-rev-comment{border:1px solid rgba(133,201,255,0.45);border-radius:8px;padding:10px 12px;font-size:0.9rem;font-family:inherit;}' +
      '.sag-rev-comment{resize:vertical;min-height:70px;}' +
      '.sag-rev-submit{background:var(--blue,#1a6fb5);color:#fff;border:none;padding:10px 20px;border-radius:30px;font-weight:700;cursor:pointer;width:fit-content;}' +
      '.sag-rev-submit:disabled{opacity:0.6;cursor:default;}' +
      '.sag-rev-msg{font-size:0.85rem;}';
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    document.querySelectorAll('.sag-reviews').forEach(renderWidget);
  }

  // Public hook: call this after dynamically inserting a .sag-reviews
  // container (e.g. product.html, which builds its whole page body
  // from a Supabase fetch — the container doesn't exist yet at
  // DOMContentLoaded, so the automatic scan below would find nothing).
  window.sagReviewsInit = init;

  // Public API for pages that manage their own product grid/cards
  // (e.g. products.html's 13 static cards + a shared review modal,
  // rather than one .sag-reviews container per product on the page).
  window.SAGReviews = {
    // { targetId: { avg, count } } for many products in one request —
    // use this to populate star ratings on a grid of cards.
    fetchSummaries: fetchSummaries,
    starsHtml: starsHtml,
    // Force-renders the full widget (summary + list + form) into a
    // container, ignoring the once-only init guard — for a shared
    // modal that gets reused for whichever product was clicked.
    renderInto: function (container, targetType, targetId, targetName, schemaId) {
      container.removeAttribute('data-sag-rev-init');
      container.setAttribute('data-target-type', targetType);
      container.setAttribute('data-target-id', targetId);
      container.setAttribute('data-target-name', targetName);
      if (schemaId) container.setAttribute('data-schema-id', schemaId);
      injectStyles();
      renderWidget(container);
    },
  };


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
