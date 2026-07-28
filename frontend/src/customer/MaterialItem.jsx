import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FaEdit, FaPlus, FaTrash } from "react-icons/fa";
import ConfirmationModal from "../components/ConfirmationModal"; // Adjust path if needed

const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL}/api`;

const UNIT_OPTIONS = ["Nos.", "Mtr", "Meter", "Kg", "Litter", "Bag", "Set", "Roll"];

const defaultSolarItems = [
  { material_name: "Structure work", unit: "Nos.", quantity: 0 },
  { material_name: "16g, 2.5x1.5 GP pipe", unit: "Nos.", quantity: 0 },
  { material_name: "16g, 1.5x1.5 GP pipe", unit: "Nos.", quantity: 0 },
  { material_name: "16g, 1x1 GP pipe", unit: "Nos.", quantity: 0 },
  { material_name: "End Cap 2.5x1.5", unit: "Nos.", quantity: 0 },
  { material_name: "End Cap 1.5x1.5", unit: "Nos.", quantity: 0 },
  { material_name: "End Cap 1x1", unit: "Nos.", quantity: 0 },
  { material_name: "4x4 Base Plate", unit: "Nos.", quantity: 0 },
  { material_name: "8 mm Anchor Bolt", unit: "Nos.", quantity: 0 },
  { material_name: "Corroshield Self Bolt", unit: "Nos.", quantity: 0 },
  { material_name: "J clamp", unit: "Nos.", quantity: 0 },
  { material_name: "Self screw", unit: "Nos.", quantity: 0 },
  { material_name: "Cement", unit: "Kg", quantity: 0 },
  { material_name: "Primer", unit: "Litter", quantity: 0 },
  { material_name: "Thinner", unit: "Litter", quantity: 0 },
  { material_name: "Roller Brush", unit: "Nos.", quantity: 0 },
  { material_name: "Materials and Consumables", unit: "Set", quantity: 0 },
  { material_name: "Solar Panels sathwik 625 NdcR", unit: "Nos.", quantity: 0 },
  { material_name: "AC Cable 6 sqmm", unit: "Mtr", quantity: 0 },
  { material_name: "Nylon Holder for 8mm Insulated Cable", unit: "Nos.", quantity: 0 },
  { material_name: "Flexible Aluminium Downconductor  S/cor  50Sqmm", unit: "Meter", quantity: 0 },
  { material_name: "Earth Pit Chamber 18x18cm", unit: "Nos.", quantity: 0 },
  { material_name: "Earthing Copper Bonded Rod 14x1220", unit: "Nos.", quantity: 0 },
  { material_name: "Excel Earthing Compound 10Kg", unit: "Bag", quantity: 0 },
  { material_name: "25mm Electrical pipe", unit: "Nos.", quantity: 0 },
  { material_name: "25mm Tee", unit: "Nos.", quantity: 0 },
  { material_name: "25mm bend", unit: "Nos.", quantity: 0 },
  { material_name: "25mm elbow", unit: "Nos.", quantity: 0 },
  { material_name: "25mm coupler", unit: "Nos.", quantity: 0 },
  { material_name: "MC4 M&F", unit: "Nos.", quantity: 0 },
  { material_name: "MID CLAMP", unit: "Nos.", quantity: 0 },
  { material_name: "END CLAMP", unit: "Nos.", quantity: 0 },
  { material_name: "Fisher and gypsom Screw", unit: "Nos.", quantity: 0 },
  { material_name: "DC Cable 4 sqmm Black", unit: "Mtr", quantity: 0 },
  { material_name: "DC Cable 4 sqmm Red", unit: "Mtr", quantity: 0 },
  { material_name: "Earthing cable 4 sqmm green", unit: "Mtr", quantity: 0 },
  { material_name: "LA multy spike(SINGLE SPIKE-2NOS.)", unit: "Nos.", quantity: 0 },
  { material_name: "Earthing Lug 10 mm", unit: "Nos.", quantity: 0 },
  { material_name: "PVC trunking 45x45mm", unit: "Mtr", quantity: 0 },
  { material_name: "8mm SS Bolt 2 inch", unit: "Nos.", quantity: 0 },
  { material_name: "Insulation Tape(R,Y,B, Black, Green)", unit: "Roll", quantity: 0 },
  { material_name: "Inverter 8kw", unit: "Nos.", quantity: 0 },
  { material_name: "Isolator 40A", unit: "Nos.", quantity: 0 },
  { material_name: "Meter Box", unit: "Nos.", quantity: 0 },
  { material_name: "Cement and Sand", unit: "Bag", quantity: 0 },
  { material_name: "ACDB 3 Phase-5KW", unit: "Nos.", quantity: 0 },
  { material_name: "DCDB 2 in 2 out-5KW", unit: "Nos.", quantity: 0 },
  { material_name: "Energy meter 3 Phase", unit: "Nos.", quantity: 0 },
  { material_name: "Net meter 3Ph", unit: "Nos.", quantity: 0 }
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

const MaterialItem = ({ customerId, canUpdate, mode = "delivery" }) => {
  // mode can be "delivery" (adds/edits items) OR "usage" (updates used/remaining qty)

  const [itemsList, setItemsList] = useState([]);
  const [originalItems, setOriginalItems] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  // Guards against a stale response overwriting fresher state if customerId
  // changes quickly (or the component unmounts) while a fetch is in flight.
  const fetchItems = useCallback(async (signal) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/material_item/${customerId}/items/`, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          setItemsList(data.items);
          setOriginalItems(data.items);
        } else if (mode === "delivery") {
          // Load default basic items only in delivery mode if empty
          setItemsList(defaultSolarItems);
          setOriginalItems(defaultSolarItems);
        } else {
          setItemsList([]);
          setOriginalItems([]);
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Failed to fetch material items:", err);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [customerId, mode]);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    fetchItems(controller.signal);
    return () => controller.abort();
  }, [customerId, fetchItems]);

  // --- DELIVERY MODE HANDLERS ---
  const handleDeliveryChange = (index, field, value) => {
    setItemsList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddItemRow = () => {
    setItemsList((prev) => [...prev, { material_name: "", quantity: 0, unit: "Nos." }]);
  };

  const handleRemoveItemRow = (index) => {
    setItemsList((prev) => prev.filter((_, i) => i !== index));
  };

  // --- USAGE/INSTALLATION MODE HANDLERS (Bilateral Auto-Calculate) ---
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
    setModalConfig({
      isOpen: true,
      title: "Confirm Inventory Update",
      message: mode === "delivery"
        ? "Are you sure you want to save these material delivery rows?"
        : "Are you sure you want to update the field usage and remaining balances?",
      onConfirm: executeSave
    });
  };

  const executeSave = async () => {
    setSaving(true);
    setModalConfig((prev) => ({ ...prev, isOpen: false }));

    try {
      if (mode === "delivery") {
        // Save the whole array via the main material endpoint
        const payload = new FormData();
        const itemsWithSlNo = itemsList.map((item, index) => ({
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
        // Only items with an id and a delivered quantity > 0 are eligible.
        const validItemsToUpdate = itemsList.filter(
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

  // View Mode / Usage Mode Filter: Only show items where quantity > 0 (unless
  // editing delivery where we need to see 0 qty items to add quantities)
  const displayItems = useMemo(
    () => (isEditing && mode === "delivery"
      ? itemsList
      : itemsList.filter((item) => parseFloat(item.quantity) > 0)),
    [itemsList, isEditing, mode]
  );

  const columnCount = mode === "usage" ? 6 : (isEditing ? 5 : 4);

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
          {!isEditing && canUpdate && (
            <button type="button" onClick={() => setIsEditing(true)}>
              <FaEdit className="icon-mr-6" />
            </button>
          )}

          {isEditing && mode === "delivery" && (
            <button type="button" className="action-view-button material-item-add-btn" onClick={handleAddItemRow}>
              <FaPlus className="icon-mr-6" /> Add Item
            </button>
          )}
        </div>
      </div>

      {/* Directory Data Grid */}
      <div className="table-responsive-wrapper">
        <table className="directory-data-grid">
          <thead>
            <tr>
              <th className="material-item-col-sl">Sl</th>
              <th>Material Name</th>
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
              displayItems.map((item, index) => (
                <tr key={item.id ?? `${item.material_name}-${index}`}>
                  <td>{isEditing ? index + 1 : item.sl_no || index + 1}</td>

                  {/* Name, Unit, Qty Fields (Editable ONLY in Delivery Mode) */}
                  <td>
                    {isEditing && mode === "delivery" ? (
                      <input
                        type="text"
                        className="form-input"
                        value={item.material_name || ""}
                        onChange={(e) => handleDeliveryChange(index, "material_name", e.target.value)}
                      />
                    ) : (
                      item.material_name || "Unnamed"
                    )}
                  </td>
                  <td>
                    {isEditing && mode === "delivery" ? (
                      <select
                        className="control-select-dropdown"
                        value={item.unit || "Nos."}
                        onChange={(e) => handleDeliveryChange(index, "unit", e.target.value)}
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
                        onChange={(e) => handleDeliveryChange(index, "quantity", e.target.value)}
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
                            onChange={(e) => handleUsageChange(index, "used_quantity", e.target.value)}
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
                            onChange={(e) => handleUsageChange(index, "remaining_quantity", e.target.value)}
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
                        onClick={() => handleRemoveItemRow(index)}
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