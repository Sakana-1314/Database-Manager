<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { history, historyKeymap, insertNewlineAndIndent } from '@codemirror/commands';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { sql as sqlLang, MySQL, PostgreSQL } from '@codemirror/lang-sql';
import { json as jsonLang } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: 'sql' | 'json' | 'text';
    dialect?: 'mysql' | 'postgres';
    dark?: boolean;
    /** 提示词：表名/列名 */
    schemaHint?: string[];
    placeholder?: string;
    minHeight?: string;
  }>(),
  { language: 'sql', dialect: 'mysql', dark: false, schemaHint: () => [], placeholder: '', minHeight: '220px' },
);

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'run'): void }>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'ui-monospace, Consolas, Menlo, monospace' },
});

function schemaCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w一-鿿$]+/);
  if (!word && !context.explicit) return null;
  const before = context.state.sliceDoc(0, context.pos);
  const afterDot = before.lastIndexOf('.');
  const scope = afterDot >= 0 ? before.slice(afterDot + 1) : '';
  const words = props.schemaHint.filter((w) => w.startsWith(scope));
  return {
    from: word ? word.from : context.pos,
    options: words.map((w) => ({ label: w, type: 'variable' })),
    validFor: /^[\w一-鿿$]+$/,
  };
}

function buildState(initial: string): EditorState {
  const lang: Extension =
    props.language === 'json'
      ? jsonLang()
      : props.language === 'sql'
        ? sqlLang({ dialect: props.dialect === 'postgres' ? PostgreSQL : MySQL })
        : [];
  const base: Extension = basicSetup;
  const schemaExt: Extension = autocompletion({ override: [schemaCompletion] });
  const darkExt: Extension = props.dark ? oneDark : [];
  const hintExt: Extension = props.placeholder ? cmPlaceholder(props.placeholder) : [];
  const keyExt: Extension = keymap.of([
    { key: 'Mod-Enter', run: () => { emit('run'); return true; } },
    { key: 'Shift-Enter', run: insertNewlineAndIndent },
  ]);
  const listener: Extension = EditorView.updateListener.of((u) => {
    if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
  });
  const extensions: Extension[] = [
    base,
    lang,
    schemaExt,
    history(),
    keymap.of(historyKeymap),
    baseTheme,
    EditorView.lineWrapping,
    darkExt,
    hintExt,
    keyExt,
    listener,
  ];
  return EditorState.create({ doc: initial, extensions });
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({ state: buildState(props.modelValue), parent: host.value });
});

watch(
  () => props.modelValue,
  (nv) => {
    if (!view) return;
    const cur = view.state.doc.toString();
    if (nv !== cur) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: nv ?? '' } });
    }
  },
);

watch([() => props.language, () => props.dialect, () => props.dark, () => props.schemaHint], () => {
  if (!view) return;
  const doc = view.state.doc.toString();
  view.destroy();
  view = new EditorView({ state: buildState(doc), parent: host.value! });
});

onBeforeUnmount(() => view?.destroy());

/** 选中文本；无选中则整段 */
function selectionOrAll(): string {
  if (!view) return props.modelValue ?? '';
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to).trim();
  return sel || view.state.doc.toString();
}
function getDoc(): string {
  return view ? view.state.doc.toString() : props.modelValue ?? '';
}
function focus() {
  view?.focus();
}
defineExpose({ selectionOrAll, getDoc, focus });
</script>

<template>
  <div ref="host" class="sql-editor" :style="{ minHeight, height: '100%' }" />
</template>

<style scoped>
.sql-editor {
  border: 1px solid var(--n-border-color, rgba(128,128,128,0.2));
  border-radius: 6px;
  overflow: hidden;
}
.sql-editor :deep(.cm-editor) {
  height: 100%;
}
</style>