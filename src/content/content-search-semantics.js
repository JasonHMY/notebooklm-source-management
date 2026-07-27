(function () {
    'use strict';

    /**
     * Pure search semantics shared by filtering and rendering.
     * This module deliberately has no DOM dependency: rendering adapters can
     * translate segmentText() output into their own highlighted nodes.
     */
    function createContentSearchSemantics(deps = {}) {
        const {
            getGroupsById,
            getTagsById,
            getParentMap,
            getSourceTagIds
        } = deps;

        if (
            typeof getGroupsById !== 'function'
            || typeof getTagsById !== 'function'
            || typeof getParentMap !== 'function'
            || typeof getSourceTagIds !== 'function'
        ) {
            throw new Error(
                'GeminiNotebook-Source-Management: createContentSearchSemantics requires getGroupsById, getTagsById, getParentMap and getSourceTagIds.'
            );
        }

        function normalizeSearchTerm(value) {
            return String(value || '')
                .trim()
                .replace(/^["']|["']$/g, '')
                .replace(/\s+/g, ' ')
                .toLowerCase();
        }

        function getUniqueSearchTerms(terms) {
            const seen = new Set();
            return (Array.isArray(terms) ? terms : [])
                .map(normalizeSearchTerm)
                .filter((term) => {
                    if (!term || seen.has(term)) return false;
                    seen.add(term);
                    return true;
                });
        }

        function parseQuery(query) {
            const raw = String(query || '');
            const tagTerms = [];
            const folderTerms = [];
            const remainingParts = [];
            let lastIndex = 0;
            const scopedPattern = /\b(tag|folder):("[^"]+"|'[^']+'|[^\s]+)/gi;
            let match;

            while ((match = scopedPattern.exec(raw)) !== null) {
                if (match.index > lastIndex) {
                    remainingParts.push(raw.slice(lastIndex, match.index));
                }

                const scope = String(match[1] || '').toLowerCase();
                const term = normalizeSearchTerm(match[2]);
                if (term) {
                    if (scope === 'tag') tagTerms.push(term);
                    if (scope === 'folder') folderTerms.push(term);
                }
                lastIndex = scopedPattern.lastIndex;
            }

            if (lastIndex < raw.length) {
                remainingParts.push(raw.slice(lastIndex));
            }

            const textTerms = getUniqueSearchTerms(remainingParts.join(' ').split(/\s+/));
            const parsedTagTerms = getUniqueSearchTerms(tagTerms);
            const parsedFolderTerms = getUniqueSearchTerms(folderTerms);

            return {
                raw,
                textTerms,
                tagTerms: parsedTagTerms,
                folderTerms: parsedFolderTerms,
                hasQuery: textTerms.length > 0
                    || parsedTagTerms.length > 0
                    || parsedFolderTerms.length > 0
            };
        }

        function normalizeCriteria(criteria) {
            if (typeof criteria === 'string') return parseQuery(criteria);
            if (!criteria || typeof criteria !== 'object') return parseQuery('');

            const textTerms = getUniqueSearchTerms(criteria.textTerms);
            const tagTerms = getUniqueSearchTerms(criteria.tagTerms);
            const folderTerms = getUniqueSearchTerms(criteria.folderTerms);
            return {
                raw: typeof criteria.raw === 'string' ? criteria.raw : '',
                textTerms,
                tagTerms,
                folderTerms,
                hasQuery: textTerms.length > 0 || tagTerms.length > 0 || folderTerms.length > 0
            };
        }

        function readMapValue(map, key) {
            return map && typeof map.get === 'function' ? map.get(key) : undefined;
        }

        function buildSourceContext(source) {
            if (!source || typeof source !== 'object') {
                return {
                    titles: [],
                    tagLabels: [],
                    folderLabels: []
                };
            }

            const tagsById = getTagsById();
            const groupsById = getGroupsById();
            const parentMap = getParentMap();
            const sourceTagIds = getSourceTagIds(source.key);
            const tagLabels = (Array.isArray(sourceTagIds) ? sourceTagIds : [])
                .map((tagId) => readMapValue(tagsById, tagId)?.label)
                .filter(Boolean);
            const folderLabels = [];
            const visitedGroupIds = new Set();
            let parentId = readMapValue(parentMap, source.key);

            while (parentId && !visitedGroupIds.has(parentId)) {
                visitedGroupIds.add(parentId);
                const group = readMapValue(groupsById, parentId);
                if (group?.title) folderLabels.push(group.title);
                parentId = readMapValue(parentMap, parentId);
            }

            return {
                titles: [source.title, source.normalizedTitle, source.lowercaseTitle].filter(Boolean),
                tagLabels,
                folderLabels
            };
        }

        function anyTextIncludesTerm(values, term) {
            return (Array.isArray(values) ? values : [])
                .some((value) => String(value || '').toLowerCase().includes(term));
        }

        function allTermsMatchAnyValue(terms, values) {
            return terms.every((term) => anyTextIncludesTerm(values, term));
        }

        function matchesSource(source, criteria) {
            if (!source || typeof source !== 'object') return false;
            const parsedCriteria = normalizeCriteria(criteria);
            if (!parsedCriteria.hasQuery) return true;

            const context = buildSourceContext(source);
            const allTextValues = [
                ...context.titles,
                ...context.tagLabels,
                ...context.folderLabels
            ];

            return allTermsMatchAnyValue(parsedCriteria.textTerms, allTextValues)
                && allTermsMatchAnyValue(parsedCriteria.tagTerms, context.tagLabels)
                && allTermsMatchAnyValue(parsedCriteria.folderTerms, context.folderLabels);
        }

        function matchesGroup(group, criteria) {
            if (!group || typeof group !== 'object') return false;
            const parsedCriteria = normalizeCriteria(criteria);
            if (!parsedCriteria.hasQuery) return false;

            const titleValues = [group.title || ''];
            return parsedCriteria.tagTerms.length === 0
                && allTermsMatchAnyValue(parsedCriteria.textTerms, titleValues)
                && allTermsMatchAnyValue(parsedCriteria.folderTerms, titleValues);
        }

        function getHighlightTerms(criteria, scope = 'text') {
            const parsedCriteria = normalizeCriteria(criteria);
            if (!parsedCriteria.hasQuery) return [];

            const normalizedScope = String(scope || 'text').toLowerCase();
            if (normalizedScope === 'tag') {
                return getUniqueSearchTerms([
                    ...parsedCriteria.textTerms,
                    ...parsedCriteria.tagTerms
                ]);
            }
            if (normalizedScope === 'folder') {
                return getUniqueSearchTerms([
                    ...parsedCriteria.textTerms,
                    ...parsedCriteria.folderTerms
                ]);
            }
            return getUniqueSearchTerms(parsedCriteria.textTerms);
        }

        function buildLowercaseIndexMap(text) {
            const lowercaseText = text.toLowerCase();
            const originalStarts = [];
            const originalEnds = [];
            let originalIndex = 0;
            let mappedLength = 0;

            Array.from(text).forEach((character) => {
                const originalEnd = originalIndex + character.length;
                const lowercaseLength = character.toLowerCase().length;
                for (let index = 0; index < lowercaseLength; index += 1) {
                    originalStarts.push(originalIndex);
                    originalEnds.push(originalEnd);
                }
                mappedLength += lowercaseLength;
                originalIndex = originalEnd;
            });

            return mappedLength === lowercaseText.length
                ? { lowercaseText, originalStarts, originalEnds }
                : null;
        }

        function segmentText(value, terms) {
            const text = String(value || '');
            const normalizedTerms = getUniqueSearchTerms(terms)
                .filter((term) => term.length > 0)
                .sort((left, right) => right.length - left.length);
            if (!text) return [];
            if (normalizedTerms.length === 0) {
                return [{ text, matched: false }];
            }

            const indexMap = buildLowercaseIndexMap(text);
            if (!indexMap) {
                return [{ text, matched: false }];
            }

            const segments = [];
            let lowercaseCursor = 0;
            let originalCursor = 0;

            while (originalCursor < text.length) {
                let bestMatch = null;
                normalizedTerms.forEach((term) => {
                    let index = indexMap.lowercaseText.indexOf(term, lowercaseCursor);
                    let mappedMatch = null;
                    while (index !== -1) {
                        const endIndex = index + term.length - 1;
                        const originalStart = indexMap.originalStarts[index];
                        const originalEnd = indexMap.originalEnds[endIndex];
                        if (
                            Number.isInteger(originalStart)
                            && Number.isInteger(originalEnd)
                            && originalStart >= originalCursor
                            && originalEnd > originalStart
                        ) {
                            mappedMatch = {
                                index,
                                term,
                                originalStart,
                                originalEnd
                            };
                            break;
                        }
                        index = indexMap.lowercaseText.indexOf(term, index + 1);
                    }
                    if (!mappedMatch) return;
                    if (
                        !bestMatch
                        || mappedMatch.originalStart < bestMatch.originalStart
                        || (
                            mappedMatch.originalStart === bestMatch.originalStart
                            && term.length > bestMatch.term.length
                        )
                    ) {
                        bestMatch = mappedMatch;
                    }
                });

                if (!bestMatch) {
                    segments.push({
                        text: text.slice(originalCursor),
                        matched: false
                    });
                    break;
                }

                if (bestMatch.originalStart > originalCursor) {
                    segments.push({
                        text: text.slice(originalCursor, bestMatch.originalStart),
                        matched: false
                    });
                }
                segments.push({
                    text: text.slice(bestMatch.originalStart, bestMatch.originalEnd),
                    matched: true
                });
                lowercaseCursor = bestMatch.index + bestMatch.term.length;
                originalCursor = bestMatch.originalEnd;
            }

            return segments;
        }

        return {
            parseQuery,
            buildSourceContext,
            matchesSource,
            matchesGroup,
            getHighlightTerms,
            segmentText
        };
    }

    globalThis.NSM_CREATE_CONTENT_SEARCH_SEMANTICS = createContentSearchSemantics;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSearchSemantics;
    }
})();
