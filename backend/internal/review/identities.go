package review

import (
	"fmt"

	"github.com/yuxincs/reviewlet/backend/internal/api"
)

func forEachGuideReference(finding *api.ReviewFinding, visit func(*api.SymbolReference)) {
	for i := range finding.Steps {
		step := &finding.Steps[i]
		if step.Links != nil {
			for j := range *step.Links {
				visit(&(*step.Links)[j])
			}
		}
		if step.Flow != nil {
			for j := range step.Flow.Nodes {
				if ref := step.Flow.Nodes[j].Reference; ref != nil {
					visit(ref)
				}
			}
		}
	}
}

func mergeGuideIdentities(findings []api.ReviewFinding) {
	for i := range findings {
		names := map[string]string{}
		forEachGuideReference(&findings[i], func(ref *api.SymbolReference) {
			if _, ok := names[ref.SymbolId]; !ok {
				names[ref.SymbolId] = fmt.Sprintf("%s:s%d", findings[i].Id, len(names)+1)
			}
			ref.SymbolId = names[ref.SymbolId]
		})
	}
	parent := map[string]string{}
	positions := map[[3]int]string{}
	var root func(string) string
	root = func(id string) string {
		if p, ok := parent[id]; !ok {
			parent[id] = id
			return id
		} else if p != id {
			parent[id] = root(p)
		}
		return parent[id]
	}
	for i := range findings {
		forEachGuideReference(&findings[i], func(ref *api.SymbolReference) {
			id := root(ref.SymbolId)
			position := [3]int{ref.Line, ref.StartColumn, ref.EndColumn}
			if previous, ok := positions[position]; ok {
				parent[id] = root(previous)
			} else {
				positions[position] = id
			}
		})
	}
	for i := range findings {
		forEachGuideReference(&findings[i], func(ref *api.SymbolReference) { ref.SymbolId = root(ref.SymbolId) })
	}
}
