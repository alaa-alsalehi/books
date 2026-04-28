<template>
  <div>
    <div v-if="showLabel && df" :class="labelClasses">
      {{ df.label }}
    </div>
    <div :class="containerClasses" class="flex gap-2 items-center">
      <label
        for="attachment"
        class="block whitespace-nowrap overflow-auto no-scrollbar"
        :class="[
          inputClasses,
          !value ? 'text-gray-600 dark:text-gray-400' : 'cursor-default',
        ]"
        >{{ label }}</label
      >
      <img
        v-if="previewUrl && showImagePreview"
        :src="previewUrl"
        class="
          h-9
          max-w-[72px]
          object-contain
          rounded
          border border-gray-200
          dark:border-gray-700
          flex-shrink-0
        "
        alt=""
      />
      <input
        id="attachment"
        ref="fileInput"
        type="file"
        accept="image/*,.pdf"
        class="hidden"
        :disabled="!!value"
        @input="selectFile"
      />

      <!-- Buttons -->
      <div class="me-2 flex gap-1">
        <!-- Upload Button -->
        <button v-if="!value" class="p-0.5 rounded" @click="upload">
          <FeatherIcon
            name="upload"
            class="h-4 w-4 text-gray-600 dark:text-gray-400"
          />
        </button>

        <!-- Download Button -->
        <button v-if="value" class="p-0.5 rounded" @click="download">
          <FeatherIcon
            name="download"
            class="h-4 w-4 text-gray-600 dark:text-gray-400"
          />
        </button>

        <!-- Clear Button -->
        <button
          v-if="value && !isReadOnly"
          class="p-0.5 rounded"
          @click="clear"
        >
          <FeatherIcon
            name="x"
            class="h-4 w-4 text-gray-600 dark:text-gray-400"
          />
        </button>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import { t } from 'fyo';
import { Attachment } from 'fyo/core/types';
import { Field } from 'schemas/types';
import {
  attachmentLooksLikeImage,
  resolveAttachmentDataUrl,
} from 'src/utils/attachments';
import { fyo } from 'src/initFyo';
import { defineComponent, PropType } from 'vue';
import FeatherIcon from '../FeatherIcon.vue';
import Base from './Base.vue';

export default defineComponent({
  components: { FeatherIcon },
  extends: Base,
  props: {
    df: Object as PropType<Field>,
    value: { type: Object as PropType<Attachment | null>, default: null },
    border: { type: Boolean, default: false },
    size: String,
  },
  data() {
    return {
      previewUrl: null as string | null,
    };
  },
  computed: {
    label() {
      if (this.value) {
        return this.value.name;
      }

      return this.df?.placeholder ?? this.df?.label ?? t`Attachment`;
    },
    showImagePreview() {
      const v = this.value as Attachment | null;
      if (!v || !this.previewUrl) {
        return false;
      }
      if (attachmentLooksLikeImage(v)) {
        return true;
      }
      return this.previewUrl.startsWith('data:image');
    },
    inputReadOnlyClasses() {
      if (!this.value) {
        return 'text-gray-600';
      } else if (this.isReadOnly) {
        return 'text-gray-800 cursor-default';
      }

      return 'text-gray-900';
    },
    containerReadOnlyClasses() {
      return '';
    },
  },
  watch: {
    value: {
      deep: true,
      handler() {
        void this.refreshPreview();
      },
    },
  },
  mounted() {
    void this.refreshPreview();
  },
  methods: {
    upload() {
      (this.$refs.fileInput as HTMLInputElement).click();
    },
    async refreshPreview() {
      this.previewUrl = await resolveAttachmentDataUrl(this.value, fyo);
    },
    async clear() {
      this.previewUrl = null;
      (this.$refs.fileInput as HTMLInputElement).value = '';
      // @ts-ignore
      this.triggerChange(null);
    },
    async download() {
      if (!this.value?.name) {
        return;
      }

      const dataUrl = await resolveAttachmentDataUrl(this.value, fyo);
      if (!dataUrl) {
        return;
      }

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = dataUrl;
      a.target = '_self';
      a.download = this.value.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    async selectFile(e: Event) {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) {
        return;
      }

      const attachment = await this.getAttachment(file);
      // @ts-ignore
      this.triggerChange(attachment);
      await this.$nextTick();
      await this.refreshPreview();
    },
    async getAttachment(file: File | null) {
      if (!file) {
        return null;
      }

      const name = file.name;
      const type = file.type || 'application/octet-stream';
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Always produce a data URL for immediate preview.
      const fr = new FileReader();
      const dataURL = await new Promise<string>((resolve, reject) => {
        fr.addEventListener('loadend', () => resolve(fr.result as string));
        fr.addEventListener('error', () => reject(new Error('failed to read file')));
        fr.readAsDataURL(file);
      });

      // Persisting to filesystem vs DB is handled at Doc.set() level.
      return { name, type, data: dataURL, bytes };
    },
  },
});
</script>
