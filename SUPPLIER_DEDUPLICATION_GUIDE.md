# Supplier Deduplication & Consolidation Guide

## Overview

This guide provides comprehensive instructions for identifying, consolidating, and preventing duplicate supplier records in your ServiceNow system. The solution includes automated tools, manual procedures, and preventive measures to ensure data integrity.

---

## Table of Contents

1. [Problem Description](#problem-description)
2. [Solution Components](#solution-components)
3. [Using the Deduplication Tool](#using-the-deduplication-tool)
4. [Manual SQL Queries](#manual-sql-queries)
5. [Data Integrity & Audit Trail](#data-integrity--audit-trail)
6. [Prevention Mechanisms](#prevention-mechanisms)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Problem Description

### Issue
When creating multiple Purchase Orders for the same supplier, users inadvertently created new duplicate supplier entries instead of selecting existing suppliers from the system. This resulted in:

- Multiple supplier records for the same vendor
- Scattered Purchase Order associations across duplicate suppliers
- Data inconsistency and reporting challenges
- Difficulty in vendor relationship management

### Impact
- **Data Integrity**: Fragmented supplier information
- **Reporting**: Inaccurate vendor spending analysis
- **Operations**: Confusion about which supplier record to use
- **Compliance**: Audit trail complexity

---

## Solution Components

### 1. Supplier Deduplication Tool
**Location**: `src/components/tables/SupplierDeduplicationTool.tsx`

**Features**:
- Automated duplicate detection using multiple algorithms:
  - Exact name matching
  - Legal name comparison
  - Vendor reference matching
  - Fuzzy name similarity (85%+ threshold)
- Visual grouping of duplicate suppliers
- Master record selection
- Automated PO reassignment
- Safe deactivation of duplicate records
- Real-time progress tracking

### 2. Enhanced Duplicate Detection
**Location**: `src/components/tables/RecordFormModal.tsx`

**Features**:
- Real-time duplicate checking during supplier creation
- Multi-field validation (name, legal name, vendor reference)
- Warning modal with suggested existing records
- Prevents accidental duplicate creation

### 3. ServiceNow API Integration
**Location**: `src/services/servicenow.ts`

**Features**:
- Type-safe API methods for supplier operations
- Error handling and retry logic
- Request/response logging

---

## Using the Deduplication Tool

### Step 1: Access the Tool

1. Navigate to **Tables** → **Suppliers**
2. Click the **"Deduplicate Suppliers"** button in the top-right corner
3. The Supplier Deduplication Tool modal will open

### Step 2: Scan for Duplicates

1. Click **"Scan for Duplicates"** to analyze all supplier records
2. The tool will identify duplicate groups based on:
   - Exact name matches
   - Legal name matches
   - Same vendor with similar names
   - High similarity scores (>85%)

### Step 3: Review Duplicate Groups

Each duplicate group displays:
- Number of duplicate suppliers found
- Match reason (e.g., "exact name match", "same vendor with similar name")
- Number of affected Purchase Orders
- Supplier details (name, legal name, city, PO count)

### Step 4: Select Master Record

1. Click on a duplicate group to view details
2. Review each supplier in the group
3. Select which record should be the **master** by clicking **"Set as Master"**
4. Consider factors:
   - Most complete information
   - Most recent updates
   - Most Purchase Orders attached
   - Vendor linkage status

### Step 5: Execute Merge

1. Review the merge operation summary:
   - Number of POs to be reassigned
   - Number of duplicate suppliers to be deactivated
   - Historical data preservation confirmation
2. Click **"Merge Duplicates"** to execute
3. Monitor real-time progress in the operation log
4. Wait for completion (marked with ✓ success icon)

### Step 6: Verify Results

1. Close the deduplication tool
2. The suppliers list will refresh automatically
3. Verify:
   - Duplicate suppliers are now marked as inactive
   - All POs reference the master supplier
   - Audit trail entries are created

---

## Manual SQL Queries

For advanced users or bulk operations, here are ServiceNow-compatible queries:

### Query 1: Identify Duplicate Suppliers by Name

```javascript
// ServiceNow Encoded Query
nameLIKE<supplier_name>

// OR via REST API
sysparm_query=nameLIKE<supplier_name>^ORlegal_nameLIKE<supplier_name>
sysparm_fields=sys_id,name,legal_name,u_vendor,active
sysparm_display_value=all
```

### Query 2: Find All POs for a Supplier

```javascript
// ServiceNow Encoded Query
supplier=<supplier_sys_id>

// OR via REST API
sysparm_query=supplier=<supplier_sys_id>
sysparm_fields=sys_id,display_name,number,total_amount,status
sysparm_display_value=all
```

### Query 3: Find Suppliers Linked to Same Vendor

```javascript
// ServiceNow Encoded Query
u_vendor=<vendor_sys_id>

// OR via REST API
sysparm_query=u_vendor=<vendor_sys_id>
sysparm_fields=sys_id,name,legal_name,active
sysparm_display_value=all
```

### Query 4: Bulk Update POs to New Supplier

```javascript
// PATCH Request to update each PO
// URL: /api/now/table/sn_shop_purchase_order/<po_sys_id>
// Body: { "supplier": "<new_supplier_sys_id>" }

// Repeat for each affected PO
```

### Query 5: Deactivate Duplicate Supplier

```javascript
// PATCH Request
// URL: /api/now/table/sn_fin_supplier/<duplicate_sys_id>
// Body: { "active": "false" }
```

---

## Data Integrity & Audit Trail

### Audit Trail Features

All operations are logged with:
- **Request Log**: Complete API request/response history
- **Timestamps**: Exact date/time of each operation
- **User Context**: Who performed the operation
- **Operation Type**: CREATE, UPDATE, DELETE, MERGE
- **Before/After Values**: Data state changes
- **Duration**: Performance metrics

### Access Audit Trail

1. Navigate to **Request Log** panel (bottom of screen)
2. Filter by:
   - Table: `sn_fin_supplier` or `sn_shop_purchase_order`
   - Method: `PATCH`, `POST`, `DELETE`
   - Date range
   - Success/Failure status

### Data Preservation Guarantees

✓ **Historical PO Records**: All Purchase Order history remains intact  
✓ **Transaction Data**: Financial data is preserved  
✓ **Referential Integrity**: All foreign key relationships are maintained  
✓ **Inactive Records**: Duplicates are deactivated, not deleted  
✓ **Rollback Capability**: Inactive suppliers can be reactivated if needed  

---

## Prevention Mechanisms

### 1. Real-Time Duplicate Detection

**When**: During supplier creation in forms  
**How**: Automatic background checks as user types  
**Action**: Warning modal shows potential duplicates with option to link existing

### 2. Enhanced Form Validation

**Location**: Supplier creation/edit forms  
**Checks**:
- Name similarity against existing suppliers
- Legal name matches
- Same vendor reference checks
- Fuzzy matching algorithms

### 3. User Guidance

**Warning Messages**:
```
⚠️ Potential duplicates found
Similar records exist with matching name:
• ABC Corporation (abc123)
• ABC Corp (abc456)

[Use Existing] [Create Anyway]
```

### 4. Vendor-Supplier Linking

**Best Practice**: Always link suppliers to vendors
- Prevents multiple suppliers for same vendor
- Enables vendor-based duplicate detection
- Improves data organization

---

## Best Practices

### For Users

1. **Search First**: Always search existing suppliers before creating new
2. **Use Full Names**: Enter complete legal names for better matching
3. **Link Vendors**: Always associate suppliers with vendors
4. **Check Warnings**: Review duplicate warnings carefully
5. **Verify Location**: Check city/state to distinguish legitimate duplicates

### For Administrators

1. **Regular Audits**: Schedule monthly duplicate scans
2. **Data Quality Rules**: Implement validation rules for supplier creation
3. **Training**: Educate users on proper supplier selection
4. **Monitoring**: Review request logs for duplicate creation patterns
5. **Preventive Measures**: Enable all duplicate detection features

### Data Cleanup Schedule

**Weekly**: Quick scan for recent duplicates  
**Monthly**: Comprehensive deduplication review  
**Quarterly**: Data quality audit and user training  
**Annually**: System-wide cleanup and optimization  

---

## Troubleshooting

### Issue: Duplicate Detection Not Working

**Symptoms**: Tool doesn't find known duplicates  
**Solutions**:
1. Check supplier names for extra spaces/characters
2. Verify legal_name field is populated
3. Ensure active=true on suppliers
4. Clear browser cache and retry scan

### Issue: Merge Operation Fails

**Symptoms**: Error during PO reassignment  
**Solutions**:
1. Check API connection status
2. Verify user has update permissions on PO table
3. Review request log for specific error messages
4. Ensure master supplier is active
5. Check for workflow/business rules conflicts

### Issue: POs Not Reassigned

**Symptoms**: POs still reference old supplier after merge  
**Solutions**:
1. Refresh the PO table view
2. Check request log for failed updates
3. Verify PO update permissions
4. Manually update problematic POs using the tool again

### Issue: Cannot Reactivate Supplier

**Symptoms**: Need to restore a deactivated supplier  
**Solutions**:
1. Navigate to supplier record in ServiceNow
2. Edit record directly
3. Set active="true"
4. Update any necessary fields
5. Re-link associated POs if needed

### Issue: Performance Degradation

**Symptoms**: Slow duplicate scanning  
**Solutions**:
1. Reduce supplier dataset (filter by active only)
2. Check network connection
3. Scan during off-peak hours
4. Process smaller batches manually
5. Contact system administrator for database optimization

---

## API Endpoints Reference

### Suppliers
- **List**: `GET /api/now/table/sn_fin_supplier`
- **Get**: `GET /api/now/table/sn_fin_supplier/{sys_id}`
- **Create**: `POST /api/now/table/sn_fin_supplier`
- **Update**: `PATCH /api/now/table/sn_fin_supplier/{sys_id}`
- **Delete**: `DELETE /api/now/table/sn_fin_supplier/{sys_id}`

### Purchase Orders
- **List**: `GET /api/now/table/sn_shop_purchase_order`
- **Get**: `GET /api/now/table/sn_shop_purchase_order/{sys_id}`
- **Update**: `PATCH /api/now/table/sn_shop_purchase_order/{sys_id}`

### Query Parameters
- `sysparm_query`: Encoded query string
- `sysparm_fields`: Comma-separated field list
- `sysparm_display_value`: `true|false|all`
- `sysparm_limit`: Max records to return
- `sysparm_offset`: Pagination offset

---

## Support & Contact

For additional assistance:
- Review ServiceNow documentation: [developer.servicenow.com](https://developer.servicenow.com)
- Check request logs for detailed error messages
- Contact your ServiceNow administrator
- Review application logs for debugging

---

## Version History

**v1.0.0** - Initial release
- Supplier deduplication tool
- Enhanced duplicate detection
- Audit trail integration
- Prevention mechanisms

---

*Last Updated: December 2025*