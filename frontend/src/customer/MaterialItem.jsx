import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FaEdit, FaPlus, FaTrash, FaDownload } from "react-icons/fa";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ConfirmationModal from "../components/ConfirmationModal"; // Adjust path if needed

const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL}/api`;

// Shown as the header title on the downloaded PDF — replace with the real
// company name.
const COMPANY_NAME = "Lavenir Solar";

// Watermark logo for the downloaded PDF - already pre-made transparent, so
// it's drawn as-is (no extra opacity applied). Served from Vite's public
// folder at this path (public/assets/transparent.png -> /assets/transparent.png).
const WATERMARK_LOGO_PATH = "/assets/transparent.png";

const UNIT_OPTIONS = ["Nos.", "Mtr", "Meter", "Kg", "Litter", "Bag", "Set", "Roll"];

// Toolbar filter: "Both" shows every item regardless of category.
const CATEGORY_FILTER_OPTIONS = ["All", "Electrical", "Structural"];

// Per-item category assignment: an item itself can only ever be one or the
// other, never "Both".
const ITEM_CATEGORY_OPTIONS = ["Electrical", "Structural"];

// Special category for rows added from the Usage/Installation tab that
// aren't part of the original delivered inventory (e.g. something bought
// extra in the field). Kept out of the main table + category filter, and
// shown instead in its own fully-editable "Extra Items" table, usage mode
// only.
const EXTRA_ITEM_CATEGORY = "Extra Items";

const SORT_OPTIONS = ["Default", "Quantity: High to Low", "Quantity: Low to High"];

const defaultSolarItems = [
  // Structural
  { material_name: "16g, 2.5x1.5 GP pipe", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "16g, 1.5x1.5 GP pipe", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "16g, 1x1 GP pipe", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "End Cap 2.5x1.5", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "End Cap 1.5x1.5", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "End Cap 1x1", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "4x4 Base Plate", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "8 mm Anchor Bolt", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "Corroshield Self Bolt", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "J clamp", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "Self screw", unit: "Nos.", quantity: 0, category: "Structural" },
  { material_name: "Cement", unit: "Kg", quantity: 0, category: "Structural" },
  { material_name: "Primer", unit: "Litter", quantity: 0, category: "Structural" },
  { material_name: "Thinner", unit: "Litter", quantity: 0, category: "Structural" },
  { material_name: "Roller Brush", unit: "Nos.", quantity: 0, category: "Structural" },
  // Electrical
  { material_name: "Solar Panels", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "AC Cable 6 sqmm", unit: "Mtr", quantity: 0, category: "Electrical" },
  { material_name: "Nylon Holder for 8mm Insulated Cable", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Flexible Aluminium Downconductor  S/cor  50Sqmm", unit: "Meter", quantity: 0, category: "Electrical" },
  { material_name: "Earth Pit Chamber 18x18cm", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Earthing Copper Bonded Rod 14x1220", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Excel Earthing Compound 10Kg", unit: "Bag", quantity: 0, category: "Electrical" },
  { material_name: "25mm Electrical pipe", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "25mm Tee", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "25mm bend", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "25mm elbow", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "25mm coupler", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "MC4 M&F", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "MID CLAMP", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "END CLAMP", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Fisher and gypsom Screw", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "DC Cable 4 sqmm Black", unit: "Mtr", quantity: 0, category: "Electrical" },
  { material_name: "DC Cable 4 sqmm Red", unit: "Mtr", quantity: 0, category: "Electrical" },
  { material_name: "Earthing cable 4 sqmm green", unit: "Mtr", quantity: 0, category: "Electrical" },
  { material_name: "LA multy spike(SINGLE SPIKE-2NOS.)", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Earthing Lug 10 mm", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "PVC trunking 45x45mm", unit: "Mtr", quantity: 0, category: "Electrical" },
  { material_name: "8mm SS Bolt 2 inch", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Insulation Tape(R,Y,B, Black, Green)", unit: "Roll", quantity: 0, category: "Electrical" },
  { material_name: "Inverter 8kw", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Isolator 40A", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Meter Box", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Cement and Sand", unit: "Bag", quantity: 0, category: "Electrical" },
  { material_name: "ACDB 3 Phase-5KW", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "DCDB 2 in 2 out-5KW", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Energy meter 3 Phase", unit: "Nos.", quantity: 0, category: "Electrical" },
  { material_name: "Net meter 3Ph", unit: "Nos.", quantity: 0, category: "Electrical" }
];

// Centralized fetch helper: attaches auth header + base URL, avoids repeating
// the same boilerplate in every call site.
const apiFetch = (path, { signal, ...options } = {}) =>
  fetch(`${API_BASE_URL}${path}`, {
    ...options,
    signal,
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token")}`,
      ...(options.headers || {})
    }
  });

// Loads the watermark logo once per download and returns it as a data URL
// (jsPDF's addImage needs base64/data-URL, not a plain <img> src path),
// plus its natural aspect ratio so it can be centered on the page without
// stretching.
const loadWatermarkLogo = () =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL("image/png"), aspect: img.naturalWidth / img.naturalHeight });
    };
    img.onerror = reject;
    img.src = WATERMARK_LOGO_PATH;
  });

const MaterialItem = ({ customerId, canUpdate, mode = "delivery", customerName }) => {
  // mode can be "delivery" (adds/edits items) OR "usage" (updates used/remaining qty)

  const [itemsList, setItemsList] = useState([]);
  const [originalItems, setOriginalItems] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fallback name fetch: if a parent up the chain forgot to pass
  // customerName down as a prop, fetch it directly so the PDF header never
  // shows a blank/"N/A" name. Prefers the prop when it's actually given.
  const [fetchedCustomerName, setFetchedCustomerName] = useState("");
  const resolvedCustomerName = customerName || fetchedCustomerName;

  useEffect(() => {
    if (customerName || !customerId) return; // prop already provided, skip fetch
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/customers/${customerId}`);
        if (res.ok) {
          const data = await res.json();
          const name = data?.data?.customer_name || data?.customer_name;
          if (!cancelled && name) setFetchedCustomerName(name);
        }
      } catch (err) {
        console.error("Failed to fetch customer name fallback:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, customerName]);

  // Ref to keep track of input elements for auto-scrolling and focus
  const inputRefs = useRef([]);

  // Category-wise filtering + search — used on both the Material Inventory
  // (delivery) page and the Installation Material Items (usage) section.
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("Default");

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  // Raw fetch helper that returns the items array directly instead of only
  // writing to state — needed so executeSave() can read freshly-created
  // Extra Items rows (with their real DB ids) synchronously mid-save.
  const fetchItemsRaw = useCallback(async (signal) => {
    const res = await apiFetch(`/material_item/${customerId}/items/`, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  }, [customerId]);

  // Guards against a stale response overwriting fresher state if customerId
  // changes quickly (or the component unmounts) while a fetch is in flight.
  const fetchItems = useCallback(async (signal) => {
    setLoading(true);
    try {
      const items = await fetchItemsRaw(signal);
      if (items.length > 0) {
        setItemsList(items);
        setOriginalItems(items);
      } else if (mode === "delivery") {
        // Load default basic items only in delivery mode if empty
        setItemsList(defaultSolarItems);
        setOriginalItems(defaultSolarItems);
      } else {
        setItemsList([]);
        setOriginalItems([]);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Failed to fetch material items:", err);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fetchItemsRaw, mode]);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    fetchItems(controller.signal);
    return () => controller.abort();
  }, [customerId, fetchItems]);

  // --- DELIVERY MODE HANDLERS (also reused for Extra Items rows) ---
  const handleDeliveryChange = (index, field, value) => {
    setItemsList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddItemRow = () => {
    setItemsList((prev) => {
      const updated = [
        ...prev,
        mode === "usage"
          // Rows added from the Usage/Installation tab are tagged as Extra
          // Items so they render in their own table, never the main one.
          ? { material_name: "", quantity: 0, unit: "Nos.", category: EXTRA_ITEM_CATEGORY, used_quantity: 0, remaining_quantity: 0 }
          : { material_name: "", quantity: 0, unit: "Nos.", category: "Electrical" }
      ];
      return updated;
    });

    // Automatically scroll to and focus the newly created input row
    setTimeout(() => {
      const newIndex = itemsList.length;
      if (inputRefs.current[newIndex]) {
        inputRefs.current[newIndex].scrollIntoView({ behavior: "smooth", block: "center" });
        inputRefs.current[newIndex].focus();
      }
    }, 100);
  };

  const handleRemoveItemRow = (index) => {
    setItemsList((prev) => prev.filter((_, i) => i !== index));
  };

  // Finds the first material name that repeats within the same category
  // (case/whitespace-insensitive). Returns null when there are no duplicates.
  const findDuplicateMaterial = (items) => {
    const seen = new Set();
    for (const it of items) {
      const name = (it.material_name || "").trim().toLowerCase();
      if (!name) continue;
      const category = (it.category || "Electrical").trim().toLowerCase();
      const key = `${name}|${category}`;
      if (seen.has(key)) return it.material_name;
      seen.add(key);
    }
    return null;
  };

  // --- USAGE/INSTALLATION MODE HANDLERS (Bilateral Auto-Calculate) ---
  // Also reused for Extra Items rows' Used/Remain fields.
  const handleUsageChange = (index, field, rawValue) => {
    // Allow clearing the field while typing instead of snapping to 0.
    if (rawValue === "") {
      setItemsList((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: "" };
        return next;
      });
      return;
    }

    const val = parseFloat(rawValue) || 0;
    setItemsList((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      const totalQty = parseFloat(item.quantity) || 0;

      if (field === "used_quantity") {
        // User typed in Used -> Auto calculate Remain
        const safeUsed = Math.min(Math.max(0, val), totalQty);
        item.used_quantity = safeUsed;
        item.remaining_quantity = totalQty - safeUsed;
      } else if (field === "remaining_quantity") {
        // User typed in Remain -> Auto calculate Used
        const safeRemain = Math.min(Math.max(0, val), totalQty);
        item.remaining_quantity = safeRemain;
        item.used_quantity = totalQty - safeRemain;
      }

      next[index] = item;
      return next;
    });
  };

  // --- SAVE ACTIONS ---
  const handleSaveClick = () => {
    // Automatically filter out rows where material_name is empty or just whitespace to save time
    const cleanedItems = itemsList.filter((item) => (item.material_name || "").trim() !== "");
    
    if (cleanedItems.length !== itemsList.length) {
      setItemsList(cleanedItems);
    }

    if (mode === "delivery") {
      const duplicateName = findDuplicateMaterial(cleanedItems);
      if (duplicateName) {
        alert(`Duplicate material item found: "${duplicateName}". Please rename or remove the duplicate row before saving.`);
        return;
      }
    }

    setModalConfig({
      isOpen: true,
      title: "Confirm Inventory Update",
      message: mode === "delivery"
        ? "Are you sure you want to save these material delivery rows?"
        : "Are you sure you want to update the field usage and remaining balances?",
      onConfirm: () => executeSave(cleanedItems)
    });
  };

  const executeSave = async (cleanedItems) => {
    setSaving(true);
    setModalConfig((prev) => ({ ...prev, isOpen: false }));

    try {
      if (mode === "delivery") {
        // Save the whole array via the main material endpoint
        const payload = new FormData();
        const itemsWithSlNo = cleanedItems.map((item, index) => ({
          ...item,
          sl_no: index + 1
        }));
        payload.append("items", JSON.stringify(itemsWithSlNo));

        const res = await apiFetch(`/material/${customerId}/`, {
          method: "PUT",
          body: payload
        });

        if (!res.ok) throw new Error("Failed to save delivery items. Ensure General Delivery is created first.");

      } else if (mode === "usage") {
        const hasExtraChanges =
          cleanedItems.some((i) => i.category === EXTRA_ITEM_CATEGORY) ||
          originalItems.some(
            (i) => i.category === EXTRA_ITEM_CATEGORY && !cleanedItems.find((c) => c.id === i.id)
          );

        // Items we'll run the usage (used_quantity) PATCH against below.
        // Starts as the items the user edited; may get swapped out for
        // freshly-fetched rows (with real ids) after the Extra Items save.
        let workingItems = cleanedItems;

        if (hasExtraChanges) {
          // Step 1: persist Extra Items rows (name/unit/quantity/category)
          // through the same items-array endpoint the Delivery tab uses —
          // it already handles create/update/delete of item rows by id.
          // We must send the FULL item list (not just extras), since this
          // endpoint deletes any row whose id isn't present in the payload.
          const fullPayload = cleanedItems.map((item, index) => ({
            ...item,
            sl_no: item.sl_no ?? index + 1
          }));
          const payload = new FormData();
          payload.append("items", JSON.stringify(fullPayload));

          const res = await apiFetch(`/material/${customerId}/`, {
            method: "PUT",
            body: payload
          });
          if (!res.ok) throw new Error("Failed to save Extra Items. Ensure General Delivery is created first.");

          // Step 2: re-fetch so newly-added Extra Items rows get their real
          // DB ids — required before we can PATCH their used_quantity.
          const freshItems = await fetchItemsRaw();
          workingItems = freshItems.map((freshItem) => {
            // Carry over the used_quantity the user just typed for Extra
            // Items rows, matched by name+category since new rows don't
            // have a stable id until after this refetch.
            const typed = cleanedItems.find(
              (c) =>
                c.id === freshItem.id ||
                (c.category === EXTRA_ITEM_CATEGORY &&
                  freshItem.category === EXTRA_ITEM_CATEGORY &&
                  (c.material_name || "").trim().toLowerCase() ===
                    (freshItem.material_name || "").trim().toLowerCase())
            );
            return typed ? { ...freshItem, used_quantity: typed.used_quantity } : freshItem;
          });
        }

        // Only items with an id and a delivered quantity > 0 are eligible.
        const validItemsToUpdate = workingItems.filter(
          (item) => item.id && parseFloat(item.quantity) > 0
        );

        // allSettled so one failing item doesn't block the rest from saving,
        // and we can report every failure instead of only the first.
        const results = await Promise.allSettled(
          validItemsToUpdate.map((item) =>
            apiFetch(`/material_item/${item.id}/usage/`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ used_quantity: item.used_quantity })
            }).then(async (res) => {
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `Failed to update item ID ${item.id}`);
              }
              return res.json();
            })
          )
        );

        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          throw new Error(
            failures.map((f) => f.reason?.message || "Unknown error").join("; ")
          );
        }
      }

      setIsEditing(false);
      await fetchItems();
    } catch (err) {
      alert(err.message || "An error occurred while saving.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setItemsList(originalItems); // Revert to original DB state
    setIsEditing(false);
  };

  // Builds a PDF of Sl / Material Name / Category / Unit / Total Qty for
  // every item with a delivered quantity greater than 0. Header shows the
  // company name, a section title, and the customer + download date.
  const handleDownloadPdf = async () => {
    const rows = itemsList
      .filter((item) => (parseFloat(item.quantity) || 0) > 0)
      .map((item, i) => [
        i + 1,
        item.material_name || "Unnamed",
        item.category || "Electrical",
        item.unit || "",
        item.quantity
      ]);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);

    // Measure each part so the combined two-tone title is truly centered on
    // the page, the same way "Material Items" below it is centered.
    const partOne = "Lavenir ";
    const partTwo = "Solar";
    const partOneWidth = doc.getStringUnitWidth(partOne) * doc.getFontSize() / doc.internal.scaleFactor;
    const partTwoWidth = doc.getStringUnitWidth(partTwo) * doc.getFontSize() / doc.internal.scaleFactor;
    const titleStartX = (pageWidth - (partOneWidth + partTwoWidth)) / 2;

    doc.setTextColor(4, 44, 83);
    doc.text(partOne, titleStartX, 15, { align: "left" });

    doc.setTextColor(186, 117, 23);
    doc.text(partTwo, titleStartX + partOneWidth, 15, { align: "left" });

    doc.setFontSize(12);
    doc.setFont(undefined, "normal");
    doc.text("Material Items", pageWidth / 2, 22, { align: "center" });

    doc.setFontSize(10);
    doc.text(`Customer Name: ${resolvedCustomerName || "N/A"}`, 14, 32);
    doc.text(`Customer ID: ${customerId}`, 14, 38);
    doc.text(`Date: ${new Date().toLocaleDateString("en-GB")}`, pageWidth - 14, 32, { align: "right" });

    autoTable(doc, {
      startY: 48, // gap between "Customer ID" line and the table
      head: [["Sl", "Material Name", "Category", "Unit", "Total Qty"]],
      body: rows
    });

    // Centered watermark logo on every page, including whichever pages
    // autoTable ended up creating for a long items list. Done last so the
    // final page count is known; the logo file is already pre-made
    // transparent/faint, so no extra opacity is applied on top of it.
    try {
      const { dataUrl, aspect } = await loadWatermarkLogo();
      const pageHeight = doc.internal.pageSize.getHeight();
      const watermarkWidth = pageWidth * 0.6;
      const watermarkHeight = watermarkWidth / aspect;
      const x = (pageWidth - watermarkWidth) / 2;
      const y = (pageHeight - watermarkHeight) / 2;

      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.addImage(dataUrl, "PNG", x, y, watermarkWidth, watermarkHeight);
      }
    } catch (err) {
      // Missing/unreachable logo file shouldn't block the PDF download.
      console.error("Failed to add watermark logo to PDF:", err);
    }

    doc.save(`material-items-${customerId}.pdf`);
  };

  // View Mode / Usage Mode Filter: Only show items where quantity > 0 (unless
  // editing delivery where we need to see 0 qty items to add quantities)
    // Keeps each item paired with its real index in itemsList so edits/deletes
    // still target the correct row even after category/search/sort filtering.
    // Extra Items rows are always excluded from the main table — they live
    // exclusively in the separate Extra Items table below (usage mode only).
    const displayItems = useMemo(() => {
      const withIndex = itemsList
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.category !== EXTRA_ITEM_CATEGORY);

      let filtered = mode === "delivery"
        ? withIndex
        : withIndex.filter(({ item }) => parseFloat(item.quantity) > 0);

      // Category filter
      if (categoryFilter !== "All") {
        filtered = filtered.filter(({ item }) => (item.category || "Electrical") === categoryFilter);
      }

      // Search filter
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        filtered = filtered.filter(({ item }) => (item.material_name || "").toLowerCase().includes(q));
      }

      // Sort logic based on Quantity
      if (sortOption === "Quantity: High to Low") {
        filtered.sort((a, b) => (parseFloat(b.item.quantity) || 0) - (parseFloat(a.item.quantity) || 0));
      } else if (sortOption === "Quantity: Low to High") {
        filtered.sort((a, b) => (parseFloat(a.item.quantity) || 0) - (parseFloat(b.item.quantity) || 0));
      }

      return filtered;
    }, [itemsList, mode, categoryFilter, searchTerm, sortOption]);

  // Extra Items: usage-mode-only rows added via "Add Item", kept in their
  // own table further down. Every column is editable while isEditing,
  // regardless of category/search/sort filters above (those only apply to
  // the main table).
  const extraItems = useMemo(() => {
    if (mode !== "usage") return [];
    return itemsList
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.category === EXTRA_ITEM_CATEGORY);
  }, [itemsList, mode]);

  const columnCount = mode === "usage" ? 7 : (isEditing ? 6 : 5);

  if (loading || saving) {
    return (
      <div className="material-item-loading">
        <div className="table-spinner material-item-spinner"></div>
        <p className="material-item-loading-text">Loading...</p>
      </div>
    );
  }

  return (
    <div className="material-item-component">
      {/* Standardized Header matching SiteVisit.jsx */}
      <div className="material-item-header">
        <h2 className="workspace-pane-title material-item-title">
          {mode === "delivery" ? "Material Inventory" : "Field Usage Materials"}
        </h2>

        <div className="material-item-header-actions">
          
          {mode === "delivery" && (
          <button type="button" className="material-item-download-btn" onClick={handleDownloadPdf} title="Download PDF">
            <FaDownload />
          </button>
          )}

          {!isEditing && canUpdate && (
            <button type="button" onClick={() => setIsEditing(true)}>
              <FaEdit className="icon-mr-6" />
            </button>
          )}

          {isEditing && (
            <button type="button" className="action-view-button material-item-add-btn" onClick={handleAddItemRow}>
              <FaPlus className="icon-mr-6" /> Add Item
            </button>
          )}
        </div>
      </div>

      {/* Category filter + search + sort — applies to both Material Inventory and
          Installation Material Items sections */}
      <div className="material-item-toolbar" style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "15px" }}>
        
        <input
          type="text"
          className="form-input material-item-search-input"
          placeholder="Search material name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select
          className="control-select-dropdown material-item-category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          {CATEGORY_FILTER_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

        <select
          className="control-select-dropdown material-item-sort-filter"
          value={sortOption}
          onChange={(e) => setSortOption(e.target.value)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

      </div>

      {/* Directory Data Grid */}
      <div className="table-responsive-wrapper">
        <table className="directory-data-grid">
          <thead>
            <tr>
              <th className="material-item-col-sl">Sl</th>
              <th>Material Name</th>
              <th className="material-item-col-category">Category</th>
              <th className="material-item-col-unit">Unit</th>
              <th className="material-item-col-qty">Total Qty</th>

              {/* Columns for USAGE Mode */}
              {mode === "usage" && <th className="material-item-col-usage">Used Qty</th>}
              {mode === "usage" && <th className="material-item-col-usage">Remain Qty</th>}

              {/* Action Column for DELIVERY Mode (Edit Only) */}
              {mode === "delivery" && isEditing && <th className="material-item-col-action">Action</th>}
            </tr>
          </thead>
          <tbody>
            {displayItems.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-directory-fallback">
                  No materials recorded yet.
                </td>
              </tr>
            ) : (
              displayItems.map(({ item, idx }) => (
                  <tr key={item.id ?? `row-${idx}`}>
                  <td>{isEditing ? idx + 1 : item.sl_no || idx + 1}</td>

                  {/* Name, Unit, Qty Fields (Editable ONLY in Delivery Mode) */}
                  <td>
                    {isEditing && mode === "delivery" ? (
                      <input
                        type="text"
                        className="form-input"
                        ref={(el) => (inputRefs.current[idx] = el)}
                        value={item.material_name || ""}
                        onChange={(e) => handleDeliveryChange(idx, "material_name", e.target.value)}
                      />
                    ) : (
                      item.material_name || "Unnamed"
                    )}
                  </td>
                  <td>
                    {isEditing && mode === "delivery" ? (
                      <select
                        className="control-select-dropdown"
                        value={item.category || "Electrical"}
                        onChange={(e) => handleDeliveryChange(idx, "category", e.target.value)}
                      >
                        {ITEM_CATEGORY_OPTIONS.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    ) : (
                      item.category || "Electrical"
                    )}
                  </td>
                  <td>
                    {isEditing && mode === "delivery" ? (
                      <select
                        className="control-select-dropdown"
                        value={item.unit || "Nos."}
                        onChange={(e) => handleDeliveryChange(idx, "unit", e.target.value)}
                      >
                        {UNIT_OPTIONS.map((unit) => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                    ) : (
                      item.unit
                    )}
                  </td>
                  <td>
                    {isEditing && mode === "delivery" ? (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="form-input"
                        value={item.quantity}
                        onChange={(e) => handleDeliveryChange(idx, "quantity", e.target.value)}
                        onWheel={(e) => e.target.blur()}
                      />
                    ) : (
                      item.quantity || "0"
                    )}
                  </td>

                  {/* Used and Remain Fields (Editable ONLY in Usage Mode) */}
                  {mode === "usage" && (
                    <>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            max={item.quantity}
                            step="any"
                            className="form-input material-item-used-input"
                            value={item.used_quantity ?? ""}
                            onChange={(e) => handleUsageChange(idx, "used_quantity", e.target.value)}
                            onWheel={(e) => e.target.blur()}
                          />
                        ) : (
                          item.used_quantity || "0"
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            max={item.quantity}
                            step="any"
                            className="form-input material-item-remaining-input"
                            value={item.remaining_quantity ?? ""}
                            onChange={(e) => handleUsageChange(idx, "remaining_quantity", e.target.value)}
                            onWheel={(e) => e.target.blur()}
                          />
                        ) : (
                          item.remaining_quantity || "0"
                        )}
                      </td>
                    </>
                  )}

                  {/* Action Delete Button (Only in Delivery Mode Edit) */}
                  {mode === "delivery" && isEditing && (
                    <td className="material-item-col-action">
                      <button
                        type="button"
                        onClick={() => handleRemoveItemRow(idx)}
                        className="payment-delete-card-btn material-item-delete-btn"
                      >
                        <FaTrash />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Extra Items — usage mode only. Rows added here (via "Add Item")
          never appear in the main table above; every column is editable
          while isEditing, regardless of what's typed anywhere else. */}
      {mode === "usage" && extraItems.length > 0 && (
        <div className="table-responsive-wrapper" style={{ marginTop: "24px" }}>
          <h3 className="workspace-pane-title material-item-title" style={{ marginBottom: "10px" }}>
            Extra Items
          </h3>
          <table className="directory-data-grid">
            <thead>
              <tr>
                <th className="material-item-col-sl">Sl</th>
                <th>Material Name</th>
                <th className="material-item-col-unit">Unit</th>
                <th className="material-item-col-qty">Total Qty</th>
                <th className="material-item-col-usage">Used Qty</th>
                <th className="material-item-col-usage">Remain Qty</th>
                {isEditing && <th className="material-item-col-action">Action</th>}
              </tr>
            </thead>
            <tbody>
              {extraItems.map(({ item, idx }, i) => (
                  <tr key={item.id ?? `extra-row-${idx}`}>
                    <td>{i + 1}</td>

                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          className="form-input"
                          ref={(el) => (inputRefs.current[idx] = el)}
                          value={item.material_name || ""}
                          onChange={(e) => handleDeliveryChange(idx, "material_name", e.target.value)}
                        />
                      ) : (
                        item.material_name || "Unnamed"
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <select
                          className="control-select-dropdown"
                          value={item.unit || "Nos."}
                          onChange={(e) => handleDeliveryChange(idx, "unit", e.target.value)}
                        >
                          {UNIT_OPTIONS.map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                      ) : (
                        item.unit
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="form-input"
                          value={item.quantity}
                          onChange={(e) => handleDeliveryChange(idx, "quantity", e.target.value)}
                          onWheel={(e) => e.target.blur()}
                        />
                      ) : (
                        item.quantity || "0"
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          max={item.quantity}
                          step="any"
                          className="form-input material-item-used-input"
                          value={item.used_quantity ?? ""}
                          onChange={(e) => handleUsageChange(idx, "used_quantity", e.target.value)}
                          onWheel={(e) => e.target.blur()}
                        />
                      ) : (
                        item.used_quantity || "0"
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          max={item.quantity}
                          step="any"
                          className="form-input material-item-remaining-input"
                          value={item.remaining_quantity ?? ""}
                          onChange={(e) => handleUsageChange(idx, "remaining_quantity", e.target.value)}
                          onWheel={(e) => e.target.blur()}
                        />
                      ) : (
                        item.remaining_quantity || "0"
                      )}
                    </td>

                    {isEditing && (
                      <td className="material-item-col-action">
                        <button
                          type="button"
                          onClick={() => handleRemoveItemRow(idx)}
                          className="payment-delete-card-btn material-item-delete-btn"
                        >
                          <FaTrash />
                        </button>
                      </td>
                    )}
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Standardized Footer Actions */}
      {isEditing && (
        <div className="workspace-action-trigger-row center-aligned-row material-item-footer">
          <button type="button" className="btn-action-edit" onClick={handleSaveClick}>
            Save Changes
          </button>
          <button type="button" className="btn-action-cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}

      <ConfirmationModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default MaterialItem;