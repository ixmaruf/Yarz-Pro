/**
 * ==============================================================
 * YARZ Advanced Auto-Backup & Auto-Cleanup System
 * Version: 1.0
 * Date: 2026-06-24
 * 
 * এই কোডটি প্রতিদিন রাত ১২টা-১টায় নিজে থেকে চলবে।
 * - মাসের ১ তারিখে: ব্যবসার ডেটা Google Drive-এ ব্যাকআপ নেবে।
 * - প্রতিদিন: অপ্রয়োজনীয় লগ ফাইল ডিলিট করবে।
 * ==============================================================
 */

var SUPABASE_URL = "https://xdzduowhwubogaavraap.supabase.co";
var SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkemR1b3dod3Vib2dhYXZyYWFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTEwNzgxNiwiZXhwIjoyMDk2NjgzODE2fQ.7UlQv2dKyKq-ZllQH1LJ4SFgAYXbl0dNHkV1xpH5G00";

// কোন টেবিল কত মাস পর পর ব্যাকআপ হবে
var CONFIG = {
  "orders": 2,
  "website_orders": 2,
  "transactions": 2,
  "inventory": 2,
  "expenses": 6,
  "monthly_reports": 6,
  "yearly_reports": 12
};

var LOG_DATA_DAYS = 30;
var AUDIT_DATA_DAYS = 90;

// ==========================================
// মেইন ফাংশন (এটি প্রতিদিন রাতে চলবে)
// ==========================================
function YARZ_Nightly_Maintenance() {
  Logger.log("Starting YARZ Nightly Maintenance...");
  
  var today = new Date();
  
  // ১. Business Data Backup (শুধু মাসের ১ তারিখে)
  if (today.getDate() === 1) {
    Logger.log("Today is the 1st! Running Monthly Backup...");
    var currentMonth = today.getMonth() + 1;
    
    // ১.১. ডিলিটের আগে Monthly Summary তৈরি ও সেভ করা (২ মাসের জন্য)
    if (currentMonth % 2 === 1) {
      try {
        var summaryRange = getBackupRange(today, 2);
        generateMonthlySummary(summaryRange.firstDay, summaryRange.lastDay);
      } catch (e) {
        Logger.log("Error generating monthly summaries: " + e.toString());
      }
    }
    
    for (var tableName in CONFIG) {
      var interval = CONFIG[tableName];
      var shouldRun = false;
      
      if (interval === 2 && currentMonth % 2 === 1) shouldRun = true;
      if (interval === 6 && currentMonth % 6 === 1) shouldRun = true;
      if (interval === 12 && currentMonth === 1) shouldRun = true;
      
      if (shouldRun) {
        var range = getBackupRange(today, interval);
        processTableBackup(tableName, range);
      }
    }
  } else {
    Logger.log("Not the 1st. Skipping business backups.");
  }
  
  // ২. System Logs Cleanup (প্রতিদিন)
  Logger.log("Running daily log cleanup...");
  deleteOldData("admin_login_attempts", "created_at", LOG_DATA_DAYS);
  deleteOldData("admin_sessions", "created_at", LOG_DATA_DAYS);
  deleteOldData("rate_limit_log", "created_at", LOG_DATA_DAYS);
  deleteOldData("fortress_log", "created_at", AUDIT_DATA_DAYS);
  deleteOldData("_activity", "ts", AUDIT_DATA_DAYS);
  deleteOldData("audit_log", "ts", AUDIT_DATA_DAYS);
  
  Logger.log("YARZ Nightly Maintenance Complete!");
}

// ==========================================
// তারিখের রেঞ্জ বের করা
// ==========================================
function getBackupRange(today, intervalMonths) {
  var startTarget = new Date(today.getFullYear(), today.getMonth() - intervalMonths, 1);
  var endTarget = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
  
  var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var startMonthName = months[startTarget.getMonth()];
  var endMonthName = months[endTarget.getMonth()];
  
  var label = startMonthName + "_to_" + endMonthName + "_" + endTarget.getFullYear();
  if (startTarget.getFullYear() !== endTarget.getFullYear()) {
    label = startMonthName + "_" + startTarget.getFullYear() + "_to_" + endMonthName + "_" + endTarget.getFullYear();
  }
  
  return {
    firstDay: startTarget.toISOString(),
    lastDay: endTarget.toISOString(),
    label: label
  };
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
// টেবিল ব্যাকআপ (Supabase -> Google Drive)
// ==========================================
function processTableBackup(tableName, range) {
  Logger.log("Fetching " + tableName + " for " + range.label);
  
  // সব ডেটা একসাথে আনার জন্য পেজিনেশন (১০০০ করে)
  var allData = [];
  var offset = 0;
  var batchSize = 1000;
  var keepFetching = true;
  
  while (keepFetching) {
    var url = SUPABASE_URL + "/rest/v1/" + tableName + "?created_at=gte." + range.firstDay + "&created_at=lte." + range.lastDay + "&order=created_at.asc&offset=" + offset + "&limit=" + batchSize;
    if (tableName === "monthly_reports" || tableName === "yearly_reports") {
      url = SUPABASE_URL + "/rest/v1/" + tableName + "?offset=" + offset + "&limit=" + batchSize;
    }
    
    var options = {
      method: "get",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        "Range": offset + "-" + (offset + batchSize - 1),
        "Prefer": "count=exact"
      },
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200 && response.getResponseCode() !== 206) {
      Logger.log("Error fetching " + tableName + ": " + response.getContentText());
      if (allData.length === 0) return;
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
  
  var data = allData;
  
  if (data && data.length > 0) {
    Logger.log("Found " + data.length + " records. Creating backup...");
    var csvContent = jsonToCsv(data);
    var fileName = "YARZ_" + tableName + "_" + range.label + ".csv";
    var folder = getTableFolder(tableName);
    folder.createFile(fileName, csvContent, MimeType.CSV);
    Logger.log("Backup saved: " + fileName);
    
    // ব্যাকআপ সফল হওয়ার পর Supabase থেকে ডিলিট করা
    // (Views যেমন monthly_reports, yearly_reports ডিলিট করা যায় না)
    if (tableName !== "monthly_reports" && tableName !== "yearly_reports") {
      deleteExactRange(tableName, "created_at", range.firstDay, range.lastDay);
      Logger.log("Deleted backed up data from Supabase: " + tableName);
    }
  } else {
    Logger.log("No records found in " + tableName + " for this period.");
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
// ১.২. Monthly Summaries জেনারেটর ও সেভার
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
        total_returns: 0
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

// Helper to fetch all pages of a table from Supabase for a range
function fetchAllDataForTable(tableName, firstDay, lastDay) {
  var allData = [];
  var offset = 0;
  var batchSize = 1000;
  var keepFetching = true;
  
  while (keepFetching) {
    var url = SUPABASE_URL + "/rest/v1/" + tableName + "?created_at=gte." + firstDay + "&created_at=lte." + lastDay + "&offset=" + offset + "&limit=" + batchSize;
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

// Upsert a summary row into monthly_summaries table
function upsertMonthlySummary(summary) {
  // Check if a row for this year_month already exists
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
    // Update existing row
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
