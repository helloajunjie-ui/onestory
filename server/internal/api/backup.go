package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"ink-tavern/server/internal/store"
)

// backupPack 导出包结构。
// 兼容旧版浏览器格式 {scripts,saves,assets} 与 Tauri 格式 {version,scripts,saves:[{scriptId,data}]}。
type backupPack struct {
	Version    string               `json:"version"`
	ExportedAt int64                `json:"exportedAt"`
	Scripts    []store.Script       `json:"scripts"`
	Saves      []backupSave         `json:"saves"`
	Assets     map[string]string    `json:"assets,omitempty"`
}

type backupSave struct {
	ScriptID string          `json:"scriptId"`
	Data     store.SaveData  `json:"data"`
}

// handleExportBackup 导出全量备份 .itb（JSON 文本）
func handleExportBackup(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		metas, err := st.ListScripts()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取剧本列表失败")
			return
		}
		scripts := make([]store.Script, 0, len(metas))
		for _, m := range metas {
			sc, err := st.GetScript(m.ID)
			if err == nil {
				scripts = append(scripts, sc)
			}
		}
		allSaves, err := st.ListAllSaves()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取存档失败")
			return
		}
		saves := make([]backupSave, 0, len(allSaves))
		for _, s := range allSaves {
			saves = append(saves, backupSave{ScriptID: s.Meta.ScriptID, Data: s})
		}
		assets := map[string]string{}
		if bg, ok, _ := st.LoadAsset(bgImagePath); ok {
			assets[bgImagePath] = bg
		}

		pack := backupPack{
			Version:    "1",
			ExportedAt: time.Now().UnixMilli(),
			Scripts:    scripts,
			Saves:      saves,
			Assets:     assets,
		}
		body, err := json.MarshalIndent(pack, "", "  ")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "序列化备份失败")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=ink-tavern-backup-%s.itb", time.Now().Format("2006-01-02")))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}

// handleImportBackup 导入备份，兼容 3 种格式：
//  1. 单剧本分享 .ink.json：{type:'ink-tavern-script', data: Script}
//  2. Tauri/新格式：{version, scripts:[Script], saves:[{scriptId, data}]}
//  3. 浏览器格式：{scripts, saves:[SaveData], assets}
func handleImportBackup(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var raw map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			writeError(w, http.StatusBadRequest, "备份文件解析失败")
			return
		}

		scriptCount, saveCount := 0, 0

		// 格式 1：单剧本分享
		if t, ok := raw["type"]; ok && contains(string(t), "ink-tavern-script") {
			var data store.Script
			if err := json.Unmarshal(raw["data"], &data); err != nil {
				writeError(w, http.StatusBadRequest, "剧本数据解析失败")
				return
			}
			if err := st.UpsertScript(data); err != nil {
				writeError(w, http.StatusInternalServerError, "导入剧本失败")
				return
			}
			writeJSON(w, http.StatusOK, map[string]int{"scripts": 1, "saves": 0})
			return
		}

		// scripts
		if rawScripts, ok := raw["scripts"]; ok {
			var scripts []store.Script
			if err := json.Unmarshal(rawScripts, &scripts); err != nil {
				writeError(w, http.StatusBadRequest, "scripts 数据解析失败")
				return
			}
			for _, sc := range scripts {
				if err := st.UpsertScript(sc); err != nil {
					writeError(w, http.StatusInternalServerError, "导入剧本失败")
					return
				}
				scriptCount++
			}
		}

		// saves（兼容 {scriptId,data} 与完整 SaveData 两种元素形态）
		if rawSaves, ok := raw["saves"]; ok {
			var items []json.RawMessage
			if err := json.Unmarshal(rawSaves, &items); err != nil {
				writeError(w, http.StatusBadRequest, "saves 数据解析失败")
				return
			}
			for _, item := range items {
				var obj map[string]json.RawMessage
				if err := json.Unmarshal(item, &obj); err != nil {
					continue
				}
				var data store.SaveData
				if rawData, has := obj["data"]; has {
					if err := json.Unmarshal(rawData, &data); err != nil {
						continue
					}
				} else if err := json.Unmarshal(item, &data); err != nil {
					continue
				}
				if data.Meta.ID == "" {
					continue
				}
				if err := st.UpsertSave(data); err != nil {
					writeError(w, http.StatusInternalServerError, "导入存档失败")
					return
				}
				saveCount++
			}
		}

		// assets（可能是 map 或数组）
		if rawAssets, ok := raw["assets"]; ok {
			importAssets(st, rawAssets)
		}

		if scriptCount == 0 && saveCount == 0 {
			writeError(w, http.StatusBadRequest, "备份文件中没有可导入的数据")
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"scripts": scriptCount, "saves": saveCount})
	}
}

// importAssets 兼容 map 与数组两种 assets 形态
func importAssets(st *store.Store, raw json.RawMessage) {
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err == nil {
		for p, d := range m {
			_ = st.SaveAsset(p, d)
		}
		return
	}
	var arr []struct {
		Path string `json:"path"`
		Data string `json:"data"`
	}
	if err := json.Unmarshal(raw, &arr); err == nil {
		for _, a := range arr {
			_ = st.SaveAsset(a.Path, a.Data)
		}
	}
}

func contains(s, sub string) bool {
	return strings.Contains(s, sub)
}
