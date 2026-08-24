package store

// 数据模型与前端 TS 类型 1:1 对齐（src/types/*）

// WorldbookEntry 世界书词条（静态 + 动态 L2 共用）
type WorldbookEntry struct {
	Name          string   `json:"name"`
	Type          string   `json:"type"`
	Triggers      []string `json:"triggers"`
	Content       string   `json:"content"`
	FirstAppeared int      `json:"firstAppeared"`
	LastAppeared  int      `json:"lastAppeared"`
	Active        bool     `json:"active"`
}

// ScriptMeta 剧本元数据（卡片展示用）
type ScriptMeta struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	CoverURL    string   `json:"coverUrl,omitempty"`
	Tags        []string `json:"tags"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
	PlayCount   int      `json:"playCount"`
}

// Script 剧本完整数据
type Script struct {
	Meta      ScriptMeta        `json:"meta"`
	Prompt    string            `json:"prompt"`
	Worldbook []WorldbookEntry  `json:"worldbook"`
	Guide     string            `json:"guide,omitempty"`
}

// Message 单条对话消息
type Message struct {
	ID          string `json:"id"`
	Role        string `json:"role"`
	Content     string `json:"content"`
	Timestamp   int64  `json:"timestamp"`
	Turn        int    `json:"turn"`
	Edited      bool   `json:"edited"`
	Regenerated bool   `json:"regenerated"`
}

// Branch 世界线分支
type Branch struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	ForkTurn int       `json:"forkTurn"`
	Messages []Message `json:"messages"`
}

// SaveMeta 存档元数据（存档列表展示用）
type SaveMeta struct {
	ID        string `json:"id"`
	ScriptID  string `json:"scriptId"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	TurnCount int    `json:"turnCount"`
	Summary   string `json:"summary"`
}

// SaveData 存档完整数据
type SaveData struct {
	Meta             SaveMeta          `json:"meta"`
	History          []Message         `json:"history"`
	State            map[string]any    `json:"state"`
	Branches         []Branch          `json:"branches"`
	DynamicWorldbook []WorldbookEntry  `json:"dynamicWorldbook"`
}

// AIConfig AI 配置（存 settings 表）
type AIConfig struct {
	BaseURL     string `json:"baseUrl"`
	APIKey      string `json:"apiKey"`
	Model       string `json:"model"`
	BreakPrompt string `json:"breakPrompt"`
}

// AppearanceConfig 外观配置（存 settings 表）
type AppearanceConfig struct {
	FontSize      int    `json:"fontSize"`
	BubbleOpacity int    `json:"bubbleOpacity"`
	TextColor     string `json:"textColor"`
	HeaderOpacity int    `json:"headerOpacity"`
	BgDim         int    `json:"bgDim"`
}

// Share 剧本分享快照（云端预留）
type Share struct {
	Code      string `json:"code"`
	ScriptID  string `json:"scriptId"`
	Script    string `json:"script"`
	CreatedAt int64  `json:"createdAt"`
}
