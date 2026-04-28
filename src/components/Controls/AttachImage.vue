<template>
  <div
    class="
      relative
      bg-white
      dark:bg-gray-900
      border
      dark:border-gray-800
      flex-center
      overflow-hidden
      group
    "
    :class="{
      rounded: size === 'form',
      'w-20 h-20 rounded-full': size !== 'small' && size !== 'form',
      'w-12 h-12 rounded-full': size === 'small',
    }"
    :title="df?.label"
    :style="imageSizeStyle"
  >
    <img v-if="src" :src="src" />
    <div v-else :class="[!isReadOnly ? 'group-hover:opacity-90' : '']">
      <div
        v-if="letterPlaceholder"
        class="
          flex
          h-full
          items-center
          justify-center
          text-gray-400
          dark:text-gray-600
          font-semibold
          w-full
          text-4xl
          select-none
        "
      >
        {{ letterPlaceholder }}
      </div>
      <svg
        v-else
        class="w-6 h-6 text-gray-300 dark:text-gray-600"
        viewBox="0 0 24 21"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M21 3h-4l-2-3H9L7 3H3a3 3 0 00-3 3v12a3 3 0 003 3h18a3 3 0 003-3V6a3 3 0 00-3-3zm-9 14a5 5 0 110-10 5 5 0 010 10z"
          fill="currentColor"
          fill-rule="nonzero"
        />
      </svg>
    </div>
    <div
      class="hidden w-full h-full absolute justify-center items-end"
      :class="[!isReadOnly ? 'group-hover:flex' : '']"
      style="background: rgba(0, 0, 0, 0.2); backdrop-filter: blur(2px)"
    >
      <button
        class="bg-gray-100 dark:bg-gray-800 p-0.5 rounded mb-1"
        @click="handleClick"
      >
        <FeatherIcon
          :name="shouldClear ? 'x' : 'upload'"
          class="w-4 h-4 text-gray-600 dark:text-gray-400"
        />
      </button>
    </div>
  </div>
</template>
<script lang="ts">
import { Field } from 'schemas/types';
import { fyo } from 'src/initFyo';
import {
  isAttachImageFileRef,
  getAttachImageFileRefPath,
  resolveAttachImageSrc,
} from 'src/utils/attachments';
import { getDataURL } from 'src/utils/misc';
import { defineComponent, PropType } from 'vue';
import FeatherIcon from '../FeatherIcon.vue';
import Base from './Base.vue';

const mime_types: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function inferImageMimeTypeFromName(name?: string | null) {
  const n = (name ?? '').toString();
  const ext = n.split('.').pop()?.toLowerCase() ?? '';
  return mime_types[ext] || 'application/octet-stream';
}

export default defineComponent({
  name: 'AttachImage',
  components: { FeatherIcon },
  extends: Base,
  props: {
    letterPlaceholder: { type: String, default: '' },
    value: { type: [String, Object] as PropType<any>, default: '' },
    df: { type: Object as PropType<Field> },
  },
  data() {
    return {
      src: '' as string,
    };
  },
  computed: {
    imageSizeStyle() {
      if (this.size === 'form') {
        return { width: '135px', height: '135px' };
      }
      return {};
    },
    shouldClear() {
      return !!this.value;
    },
  },
  watch: {
    value: {
      immediate: true,
      handler() {
        void this.refreshSrc();
      },
    },
  },
  methods: {
    async refreshSrc() {
      if (this.value && typeof this.value === 'object' && this.value.data) {
        const mimeType =
          typeof this.value.type === 'string' && this.value.type.length
            ? this.value.type
            : inferImageMimeTypeFromName(this.value.name);
        this.src = await getDataURL(mimeType, this.value.data);
        return;
      }
      if (typeof this.value !== 'string') {
        this.src = '';
        return;
      }

      const typeHint = isAttachImageFileRef(this.value)
        ? inferImageMimeTypeFromName(getAttachImageFileRefPath(this.value))
        : undefined;
      const resolved = await resolveAttachImageSrc(this.value, fyo, typeHint);
      this.src = resolved ?? '';
    },
    async handleClick() {
      if (this.value) {
        return await this.clearImage();
      }
      return await this.selectImage();
    },
    async clearImage() {
      // @ts-ignore
      this.triggerChange(null);
      this.src = '';
    },
    async selectImage() {
      if (this.isReadOnly) {
        return;
      }
      const options = {
        title: fyo.t`Select Image`,
        filters: [{ name: 'Image', extensions: Object.keys(mime_types) }],
      };

      const { name, success, data } = await ipc.selectFile(options);

      if (!success) {
        return;
      }
      const extension = (name.split('.').at(-1) || 'png').toLowerCase();
      const type = mime_types[extension] || inferImageMimeTypeFromName(name);
      // Persisting to filesystem vs DB is handled at Doc.set() level.
      // @ts-ignore
      this.triggerChange({ name, type, data });
      await this.$nextTick();
      await this.refreshSrc();
    },
  },
});
</script>
