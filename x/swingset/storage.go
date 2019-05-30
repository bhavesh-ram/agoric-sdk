package swingset

import (
	"encoding/json"
	"errors"
	"fmt"

	sdk "github.com/cosmos/cosmos-sdk/types"
)

type storageHandler struct {
	Keeper  Keeper
	Context sdk.Context
}

type storageMessage struct {
	Method string `json:"method"`
	Key    string `json:"key"`
	Value  string `json:"value"`
}

func NewStorageHandler(context sdk.Context, keeper Keeper) *storageHandler {
	return &storageHandler{
		Keeper:  keeper,
		Context: context,
	}
}

func (sh *storageHandler) Receive(str string) (string, error) {
	msg := new(storageMessage)
	err := json.Unmarshal([]byte(str), &msg)
	if err != nil {
		return "", err
	}

	// Handle generic paths.
	switch msg.Method {
	case "set":
		storage := NewStorage()
		storage.Value = msg.Value
		sh.Keeper.SetStorage(sh.Context, msg.Key, storage)
		return "true", nil

	case "get":
		storage := sh.Keeper.GetStorage(sh.Context, msg.Key)
		return storage.Value, nil

	case "has":
		storage := sh.Keeper.GetStorage(sh.Context, msg.Key)
		if storage.Value == "" {
			return "", nil
		}
		return "true", nil

	case "keys":
		keys := sh.Keeper.GetKeys(sh.Context, msg.Key)
		if keys.Keys == nil {
			return "", nil
		}
		bytes, err := json.Marshal(keys.Keys)
		if err != nil {
			return "", err
		}
		return string(bytes), nil

	case "entries":
		keys := sh.Keeper.GetKeys(sh.Context, msg.Key)
		ents := make([][]string, len(keys.Keys))
		for i, key := range keys.Keys {
			ents[i] = make([]string, 2)
			ents[i][0] = key
			storage := sh.Keeper.GetStorage(sh.Context, fmt.Sprintf("%s.%s", msg.Key, key))
			ents[i][1] = storage.Value
		}
		bytes, err := json.Marshal(ents)
		if err != nil {
			return "", err
		}
		return string(bytes), nil

	case "values":
		keys := sh.Keeper.GetKeys(sh.Context, msg.Key)
		vals := make([]string, len(keys.Keys))
		for i, key := range keys.Keys {
			storage := sh.Keeper.GetStorage(sh.Context, fmt.Sprintf("%s.%s", msg.Key, key))
			vals[i] = storage.Value
		}
		bytes, err := json.Marshal(vals)
		if err != nil {
			return "", err
		}
		return string(bytes), nil

	case "size":
		keys := sh.Keeper.GetKeys(sh.Context, msg.Key)
		if keys.Keys == nil {
			return "0", nil
		}
		return string(len(keys.Keys)), nil
	}

	return "", errors.New("Unrecognized msg.Method " + msg.Method)
}
