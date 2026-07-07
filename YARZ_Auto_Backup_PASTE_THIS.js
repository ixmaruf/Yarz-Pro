/**
 * ==============================================================
 * YARZ Advanced Auto-Backup & Auto-Cleanup System
 * Version: 2.0 - Rolling Window
 * Date: 2026-07-08
 * 
 * এই কোডটি প্রতিদিন রাত ১২টা-১টায় নিজে থেকে চলবে।
 * - প্রতিদিন: পুরনো ব্যবসার ডেটা Google Drive-এ ব্যাকআপ নেবে (Rolling Window)।
 * - প্রতিদিন: অপ্রয়োজনীয় লগ ফাইল ডিলিট করবে।
 * - জানুয়ারিতে: inventory/delivery_charges বার্ষিক ব্যাকআপ।
 * ==============================================================
 */

var SUPABASE_URL = "https://xdzduowhwubogaavraap.supabase.co";
var SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkemR1b3dod3Vib2dhYXZyYWFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTEwNzgxNiwiZXhwIjoyMDk2NjgzODE2fQ.7UlQv2dKyKq-ZllQH1LJ4SFgAYXbl0dNHkV1xpH5G00";

// Date column mapping per table — NOT every table uses created_at!
var DATE_COLUMNS = {
  "orders": "created_at",
  "website_orders": "date",
  "transactions": "date",
  "inventory": "updated_at",
  "expenses": "date",
  "ad_tracker": "date",
  "customers": "created_at",
  "delivery_charges": "updated_at"
};

// Rolling window backup tables: key=tableName, value=retention in DAYS
// Data older than N days gets backed up and deleted EVERY DAY
var BACKUP_CONFIG = {
  "orders":            60,
  "website_orders":    60,
  "transactions":      60,
  "customers":        180,
  "expenses":         180,
  "ad_tracker":       180,
  "delivery_charges": 365
};

// Yearly backup tables — only backed up in January, never deleted
var YEARLY_BACKUP_TABLES = ["inventory", "delivery_charges"];

// Tables that should NOT be backed up but DO need cleanup
var CLEANUP_CONFIG = {
  "admin_login_attempts":    { column: "created_at",   days: 10 },
  "admin_sessions":          { column: "created_at",   days: 10 },
  "rate_limit_log":          { column: "created_at",   days: 10 },
  "audit_log":               { column: "ts",           days: 10 },
  "_activity":               { column: "ts",           days: 10 },
  "fortress_log":            { column: "created_at",   days: 10 },
  "ai_messages":             { column: "created_at",   days: 30 },
  "steadfast_consignments":  { column: "created_at",   days: 90 },
  "steadfast_balance_cache": { column: "updated_at",   days: 7 }
};

// ==========================================
// মেইন ফাংশন (এটি প্রতিদিন রাতে চলবে)
// ==========================================
function YARZ_Nightly_Maintenance() {
  Logger.log("=== Starting YARZ Nightly Maintenance (Rolling Window v2.0) ===");
  
  var today = new Date();
  var isJanuary = (today.getMonth() === 0);

  // ১. Rolling Window Backup + Delete (প্রতিদিন)
  Logger.log("--- Phase 1: Rolling window backup & cleanup ---");
  for (var tableName in BACKUP_CONFIG) {
    var retentionDays = BACKUP_CONFIG[tableName];
    
    if (YEARLY_BACKUP_TABLES.indexOf(tableName) !== -1) {
      // Yearly tables: only backup in January, never delete
      if (isJanuary) {
        Logger.log("[" + tableName + "] January yearly backup (no delete)...");
        processYearlyBackup(tableName);
      } else {
        Logger.log("[" + tableName + "] Skipping yearly table (not January).");
      }
    } else {
      Logger.log("[" + tableName + "] Rolling window backup (retention=" + retentionDays + " days)...");
      processRollingBackup(tableName, retentionDays, today);
    }
  }

  // ২. Cleanup-only tables (প্রতিদিন)
  Logger.log("--- Phase 2: Cleanup-only tables ---");
  for (var cleanupTable in CLEANUP_CONFIG) {
    var cfg = CLEANUP_CONFIG[cleanupTable];
    Logger.log("[" + cleanupTable + "] Cleaning data older than " + cfg.days + " days...");
    deleteOldData(cleanupTable, cfg.column, cfg.days);
  }

  // ৩. Visitor Stats Aggregation (প্রতিদিন)
  Logger.log("--- Phase 3: Visitor stats aggregation ---");
  aggregateVisitorStats(today);

  // ৪. Customer Summary Update (before orders get deleted - already handled in processRollingBackup)
  //    Customer summaries are updated inside processRollingBackup for the "orders" table.
  
  Logger.log("=== YARZ Nightly Maintenance Complete! ===");
}

// ==========================================
// Rolling Window Backup (প্রতিদিন চলবে)
// ==========================================
function processRollingBackup(tableName, retentionDays, today) {
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  var firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  var lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() - 1, 23, 59, 59, 999).toISOString();

  // Monthly summaries: only generate when cutoff falls on 1st (= complete months)
  var generateSummaries = (cutoff.getDate() === 1);
  if (generateSummaries) {
    Logger.log("[" + tableName + "] Cutoff is 1st of month — generating monthly summaries before delete...");
    generateSummariesForRange(firstDay, lastDay);
  }

  // Customer summary: update customers before deleting orders
  if (tableName === "orders") {
    Logger.log("[customers] Updating customer summaries from orders in deletion range...");
    updateCustomerSummary(firstDay, lastDay);
  }

  // Iterate month by month (back up each month, then delete it)
  var cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  while (cursor.getTime() > cutoff.getTime()) {
    var year = cursor.getFullYear();
    var month = cursor.getMonth();

    var mFirst = new Date(year, month, 1);
    var mLast = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Clamp to cutoff
    if (mFirst.getTime() < cutoff.getTime()) mFirst = new Date(cutoff);
    if (mLast.getTime() > new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999).getTime()) {
      mLast = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999);
    }

    var mFirstISO = mFirst.toISOString();
    var mLastISO = mLast.toISOString();

    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var label = months[month] + "_" + year;

    Logger.log("[" + tableName + "] Processing " + label + " (" + mFirstISO.substring(0,10) + " to " + mLastISO.substring(0,10) + ")...");

    var data = fetchAllDataForTable(tableName, mFirstISO, mLastISO);
    if (data && data.length > 0) {
      var csvContent = jsonToCsv(data);
      var fileName = "YARZ_" + tableName + "_" + label + ".csv";
      var folder = getTableFolder(tableName);
      folder.createFile(fileName, csvContent, MimeType.CSV);
      Logger.log("[" + tableName + "] Backup saved: " + fileName + " (" + data.length + " records)");
      deleteExactRange(tableName, DATE_COLUMNS[tableName], mFirstISO, mLastISO);
      Logger.log("[" + tableName + "] Deleted backed up data from Supabase.");
    } else {
      Logger.log("[" + tableName + "] No records found for " + label + ".");
    }

    cursor = new Date(year, month, 0); // previous month
  }
}

// ==========================================
// Yearly Backup (শুধু জানুয়ারিতে)
// ==========================================
function processYearlyBackup(tableName) {
  var today = new Date();
  var prevYear = today.getFullYear() - 1;
  var firstDay = new Date(prevYear, 0, 1).toISOString();
  var lastDay = new Date(prevYear, 11, 31, 23, 59, 59, 999).toISOString();
  var label = "Year_" + prevYear;

  Logger.log("[" + tableName + "] Yearly backup for " + label + "...");
  var data = fetchAllDataForTable(tableName, firstDay, lastDay);
  if (data && data.length > 0) {
    var csvContent = jsonToCsv(data);
    var fileName = "YARZ_" + tableName + "_" + label + ".csv";
    var folder = getTableFolder(tableName);
    folder.createFile(fileName, csvContent, MimeType.CSV);
    Logger.log("[" + tableName + "] Yearly backup saved: " + fileName + " (" + data.length + " records)");
  } else {
    Logger.log("[" + tableName + "] No records found for " + label + ".");
  }
  // Never delete yearly tables
}

// ==========================================
// Google Drive ফোল্ডার ম্যানেজমেন্ট
// ==========================================
function getTableFolder(tableName) {
  var rootName = "Yarz Data backup";
  var folders = DriveApp.getFoldersByName(rootName);
  var rootFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(rootName);
  
  var subfolders = rootFolder.getFoldersByName(tableName);
  var tableFolder = subfolders.hasNext() ? subfolders.next() : rootFolder.createFolder(tableName);
  
  return tableFolder;
}

// ==========================================
// Generate Summaries for a Date Range
// ==========================================
function generateSummariesForRange(firstDay, lastDay) {
  var startDate = new Date(firstDay);
  var endDate = new Date(lastDay);
  var cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  while (cursor <= endDate) {
    var year = cursor.getFullYear();
    var month = cursor.getMonth();
    var mFirst = new Date(year, month, 1).toISOString();
    var mLast = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();

    Logger.log("Generating monthly summary for " + (month + 1) + "/" + year + "...");
    generateMonthlySummary(mFirst, mLast);
    cursor = new Date(year, month + 1, 1);
  }
}

// ==========================================
// নির্দিষ্ট সময়ের ডেটা ডিলিট (ব্যাকআপের পর)
// ==========================================
function deleteExactRange(tableName, dateColumn, firstDay, lastDay) {
  var url = SUPABASE_URL + "/rest/v1/" + tableName + "?" + dateColumn + "=gte." + firstDay + "&" + dateColumn + "=lte." + lastDay;
  var options = {
    method: "delete",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY
    },
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

// ==========================================
// পুরনো লগ ডিলিট করা
// ==========================================
function deleteOldData(tableName, dateColumn, daysOld) {
  var d = new Date();
  d.setDate(d.getDate() - daysOld);
  var cutoff = d.toISOString();
  
  var url = SUPABASE_URL + "/rest/v1/" + tableName + "?" + dateColumn + "=lt." + cutoff;
  var options = {
    method: "delete",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
    Logger.log("Cleaned " + tableName);
  }
}

// ==========================================
// JSON কে CSV তে রূপান্তর
// ==========================================
function jsonToCsv(jsonArray) {
  if (!jsonArray || jsonArray.length === 0) return "";
  var keys = Object.keys(jsonArray[0]);
  var csv = keys.join(",") + "\n";
  for (var i = 0; i < jsonArray.length; i++) {
    var row = [];
    for (var j = 0; j < keys.length; j++) {
      var val = jsonArray[i][keys[j]];
      if (val === null || val === undefined) val = "";
      val = String(val).replace(/"/g, '""');
      row.push('"' + val + '"');
    }
    csv += row.join(",") + "\n";
  }
  return csv;
}

// ==========================================
// Monthly Summaries জেনারেটর ও সেভার
// ==========================================
function generateMonthlySummary(firstDay, lastDay) {
  Logger.log("Generating monthly summaries for range: " + firstDay + " to " + lastDay);
  
  var transactions = fetchAllDataForTable("transactions", firstDay, lastDay);
  var orders = fetchAllDataForTable("orders", firstDay, lastDay);
  var websiteOrders = fetchAllDataForTable("website_orders", firstDay, lastDay);
  var expenses = fetchAllDataForTable("expenses", firstDay, lastDay);
  var adTracker = fetchAllDataForTable("ad_tracker", firstDay, lastDay);
  
  Logger.log("Fetched for summary: " + 
             transactions.length + " txs, " + 
             orders.length + " orders, " + 
             websiteOrders.length + " web orders, " + 
             expenses.length + " expenses, " + 
             adTracker.length + " ad spend records.");
  
  var summaries = {};
  
  var getYearMonth = function(dateStr) {
    if (!dateStr) return null;
    if (dateStr.length >= 7) {
      return dateStr.substring(0, 7); // "YYYY-MM"
    }
    return null;
  };
  
  var initMonth = function(ym) {
    if (!summaries[ym]) {
      summaries[ym] = {
        year_month: ym,
        total_orders: 0,
        total_revenue: 0,
        total_cost: 0,
        total_ad_spend: 0,
        total_expenses: 0,
        net_profit: 0,
        total_returns: 0,
        total_return_amount: 0
      };
    }
  };
  
  // Aggregate transactions
  transactions.forEach(function(t) {
    var ym = getYearMonth(t.date);
    if (!ym) return;
    initMonth(ym);
    
    if (t.type === 'Return') {
      summaries[ym].total_returns += 1;
      summaries[ym].total_return_amount += Math.abs(Number(t.revenue || 0));
    }
    summaries[ym].total_revenue += Number(t.revenue || 0);
    summaries[ym].total_cost += Number(t.cost || 0);
  });
  
  // Aggregate orders (manual)
  orders.forEach(function(o) {
    var ym = getYearMonth(o.date);
    if (!ym) return;
    initMonth(ym);
    
    if (o.status !== 'Cancelled' && o.status !== 'Returned') {
      summaries[ym].total_orders += 1;
    }
  });
  
  // Aggregate website orders
  websiteOrders.forEach(function(o) {
    var ym = getYearMonth(o.date);
    if (!ym) return;
    initMonth(ym);
    
    if (o.status !== 'Cancelled' && o.status !== 'Returned') {
      summaries[ym].total_orders += 1;
    }
  });
  
  // Aggregate expenses
  expenses.forEach(function(e) {
    var ym = getYearMonth(e.date);
    if (!ym) return;
    initMonth(ym);
    
    summaries[ym].total_expenses += Number(e.amount || 0);
  });
  
  // Aggregate ad spend
  adTracker.forEach(function(a) {
    var ym = getYearMonth(a.date);
    if (!ym) return;
    initMonth(ym);
    
    summaries[ym].total_ad_spend += Number(a.spend || 0);
  });
  
  // Save each summary row
  for (var ym in summaries) {
    var s = summaries[ym];
    s.net_profit = s.total_revenue - s.total_cost - s.total_ad_spend - s.total_expenses;
    Logger.log("Upserting summary for " + ym + ": " + JSON.stringify(s));
    upsertMonthlySummary(s);
  }
}

// ==========================================
// Helper to fetch all pages of a table from Supabase for a range
// ==========================================
function fetchAllDataForTable(tableName, firstDay, lastDay) {
  var allData = [];
  var offset = 0;
  var batchSize = 1000;
  var keepFetching = true;
  
  var dateCol = DATE_COLUMNS[tableName];
  
  while (keepFetching) {
    var url;
    if (dateCol) {
      url = SUPABASE_URL + "/rest/v1/" + tableName + "?" + dateCol + "=gte." + firstDay + "&" + dateCol + "=lte." + lastDay + "&offset=" + offset + "&limit=" + batchSize;
    } else {
      url = SUPABASE_URL + "/rest/v1/" + tableName + "?offset=" + offset + "&limit=" + batchSize;
    }
    var options = {
      method: "get",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200 && response.getResponseCode() !== 206) {
      Logger.log("Error fetching " + tableName + " for summary: " + response.getContentText());
      break;
    }
    
    var batch = JSON.parse(response.getContentText());
    if (batch && batch.length > 0) {
      allData = allData.concat(batch);
      offset += batchSize;
      if (batch.length < batchSize) keepFetching = false;
    } else {
      keepFetching = false;
    }
  }
  
  return allData;
}

// ==========================================
// Upsert a summary row into monthly_summaries table
// ==========================================
function upsertMonthlySummary(summary) {
  var url = SUPABASE_URL + "/rest/v1/monthly_summaries?year_month=eq." + summary.year_month;
  var options = {
    method: "get",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var exists = false;
  var id = null;
  
  if (response.getResponseCode() === 200) {
    var rows = JSON.parse(response.getContentText());
    if (rows && rows.length > 0) {
      exists = true;
      id = rows[0].id;
    }
  }
  
  var postUrl = SUPABASE_URL + "/rest/v1/monthly_summaries";
  var method = "post";
  var headers = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json"
  };
  
  if (exists) {
    postUrl = SUPABASE_URL + "/rest/v1/monthly_summaries?id=eq." + id;
    method = "patch";
  }
  
  var postOptions = {
    method: method,
    headers: headers,
    payload: JSON.stringify(summary),
    muteHttpExceptions: true
  };
  
  var postResponse = UrlFetchApp.fetch(postUrl, postOptions);
  if (postResponse.getResponseCode() >= 200 && postResponse.getResponseCode() < 300) {
    Logger.log("Successfully saved summary for " + summary.year_month);
  } else {
    Logger.log("Failed to save summary for " + summary.year_month + ": " + postResponse.getContentText());
  }
}

// ==========================================
// Customer Summary Updater
// ==========================================
function updateCustomerSummary(firstDay, lastDay) {
  var orders = fetchAllDataForTable("orders", firstDay, lastDay);
  if (!orders || orders.length === 0) {
    Logger.log("[customers] No orders found in range. Skipping.");
    return;
  }

  var customerMap = {};
  orders.forEach(function(o) {
    var key = o.phone || o.customer_phone || o.name || o.customer_name;
    if (!key) return;
    if (!customerMap[key]) {
      customerMap[key] = {
        name: o.customer_name || o.name || "",
        phone: o.phone || o.customer_phone || "",
        total_orders: 0,
        total_spent: 0,
        last_order_date: null
      };
    }
    var c = customerMap[key];
    c.total_orders += 1;
    c.total_spent += Number(o.total || o.amount || o.price || 0);
    var orderDate = o.date || o.created_at;
    if (orderDate && (!c.last_order_date || orderDate > c.last_order_date)) {
      c.last_order_date = orderDate;
    }
  });

  var count = 0;
  for (var key in customerMap) {
    var cust = customerMap[key];
    upsertCustomerSummary(cust);
    count++;
  }
  Logger.log("[customers] Updated " + count + " customer summaries.");
}

function upsertCustomerSummary(cust) {
  var identifier = cust.phone || cust.name;
  if (!identifier) return;

  var queryParam = cust.phone ? "phone" : "name";
  var url = SUPABASE_URL + "/rest/v1/customers?" + queryParam + "=eq." + encodeURIComponent(identifier);
  
  var getOptions = {
    method: "get",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, getOptions);
  var exists = false;
  var existingId = null;
  var existingTotalOrders = 0;
  var existingTotalSpent = 0;
  var existingLastDate = null;
  
  if (response.getResponseCode() === 200) {
    var rows = JSON.parse(response.getContentText());
    if (rows && rows.length > 0) {
      exists = true;
      existingId = rows[0].id;
      existingTotalOrders = Number(rows[0].total_orders || 0);
      existingTotalSpent = Number(rows[0].total_spent || 0);
      existingLastDate = rows[0].last_order_date;
    }
  }
  
  var finalOrders = existingTotalOrders + cust.total_orders;
  var finalSpent = existingTotalSpent + cust.total_spent;
  var finalLastDate = cust.last_order_date;
  if (existingLastDate && cust.last_order_date && existingLastDate > cust.last_order_date) {
    finalLastDate = existingLastDate;
  } else if (existingLastDate && !cust.last_order_date) {
    finalLastDate = existingLastDate;
  }
  
  var payload = {
    name: cust.name || undefined,
    phone: cust.phone || undefined,
    total_orders: finalOrders,
    total_spent: finalSpent,
    last_order_date: finalLastDate
  };
  
  var postUrl = SUPABASE_URL + "/rest/v1/customers";
  var method = "post";
  var headers = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
  };
  
  if (exists) {
    postUrl = SUPABASE_URL + "/rest/v1/customers?id=eq." + existingId;
    method = "patch";
    delete payload.name;
    delete payload.phone;
  }
  
  var postOptions = {
    method: method,
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(postUrl, postOptions);
}

// ==========================================
// Visitor Stats Aggregation
// ==========================================
function aggregateVisitorStats(today) {
  var lookback = new Date(today);
  lookback.setDate(lookback.getDate() - 180);
  var firstDay = lookback.toISOString();
  var lastDay = today.toISOString();

  var visitors = fetchAllDataForTable("website_visitors", firstDay, lastDay);
  if (!visitors || visitors.length === 0) {
    Logger.log("[visitor_stats] No visitors found. Skipping.");
    return;
  }

  var dailyCounts = {};
  visitors.forEach(function(v) {
    var d = v.visit_date;
    if (!d) return;
    var dateKey = d.length >= 10 ? d.substring(0, 10) : d;
    dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
  });

  var count = 0;
  for (var dateKey in dailyCounts) {
    upsertVisitorStat(dateKey, dailyCounts[dateKey]);
    count++;
  }
  Logger.log("[visitor_stats] Updated " + count + " daily stats.");
}

function upsertVisitorStat(dateStr, visitorCount) {
  var url = SUPABASE_URL + "/rest/v1/visitor_stats?date=eq." + dateStr;
  var getOptions = {
    method: "get",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, getOptions);
  var exists = false;
  var id = null;
  
  if (response.getResponseCode() === 200) {
    var rows = JSON.parse(response.getContentText());
    if (rows && rows.length > 0) {
      exists = true;
      id = rows[0].id;
    }
  }
  
  var postUrl = SUPABASE_URL + "/rest/v1/visitor_stats";
  var method = "post";
  var headers = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
  };
  
  var payload = { date: dateStr, visitor_count: visitorCount };
  
  if (exists) {
    postUrl = SUPABASE_URL + "/rest/v1/visitor_stats?id=eq." + id;
    method = "patch";
    payload = { visitor_count: visitorCount };
  }
  
  var postOptions = {
    method: method,
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(postUrl, postOptions);
}
