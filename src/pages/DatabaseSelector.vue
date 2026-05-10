<template>
  <div
    class="flex-1 flex justify-center items-center bg-gray-25 dark:bg-gray-900"
    :class="{
      'pointer-events-none': loadingDatabase,
      'window-drag': platform !== 'Windows',
    }"
  >
    <div
      class="
        w-full w-form
        shadow-lg
        rounded-lg
        border
        dark:border-gray-800
        relative
        bg-white
        dark:bg-gray-875
      "
      style="height: 700px"
    >
      <!-- Welcome to Rukn Books -->
      <div class="px-4 py-4">
        <h1 class="text-2xl font-semibold select-none dark:text-gray-25">
          {{ t`Welcome to Rukn Books` }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400 text-base select-none">
          {{
            canShowDemo && filesLoaded && !files?.length
              ? t`Use Create Demo below to start with sample data. Saved companies appear in the list.`
              : t`Create a new company or select an existing one from your computer`
          }}
        </p>
      </div>

      <hr class="dark:border-gray-800" />

      <!-- New File (Blue Icon): hidden when demo creation is enabled — those users start via Create Demo only -->
      <div
        data-testid="create-new-file"
        v-if="filesLoaded && !files?.length && !canShowDemo"
        class="px-4 h-row-largest flex flex-row items-center gap-4 p-2"
        :class="
          creatingDemo
            ? ''
            : 'hover:bg-gray-50 dark:hover:bg-gray-890 cursor-pointer'
        "
        @click="newDatabase"
      >
        <div class="w-8 h-8 rounded-full bg-blue-500 relative flex-center">
          <feather-icon
            name="plus"
            class="text-white dark:text-gray-900 w-5 h-5"
          />
        </div>

        <div>
          <p class="font-medium dark:text-gray-200">
            {{ t`New Company` }}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t`Create a new company and store it on your computer` }}
          </p>
        </div>
      </div>

      <!-- From ERPNext Company (Purple Icon) -->
      <div
        v-if="false"
        data-testid="create-from-erpnext-company"
        class="px-4 h-row-largest flex flex-row items-center gap-4 p-2"
        :class="
          creatingDemo
            ? ''
            : 'hover:bg-gray-50 dark:hover:bg-gray-890 cursor-pointer'
        "
        @click="fromERPNextCompany"
      >
        <div
          class="w-8 h-8 rounded-full relative flex-center"
          :class="
            erpnextImportAvailable
              ? 'bg-purple-500'
              : 'bg-gray-300 dark:bg-gray-800'
          "
        >
          <feather-icon
            name="refresh-ccw"
            class="w-4 h-4"
            :class="
              erpnextImportAvailable
                ? 'text-white dark:text-gray-900'
                : 'text-gray-600 dark:text-gray-400'
            "
          />
        </div>
        <div class="w-full">
          <p class="font-medium dark:text-gray-200">
            {{ t`From ERPNext Company` }}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{
              t`Create a new company by importing chart of accounts and defaults from ERPNext`
            }}
          </p>
        </div>
      </div>

      <!-- Existing File (Green Icon) -->
      <div
        v-if="false"
        class="px-4 h-row-largest flex flex-row items-center gap-4 p-2"
        :class="
          creatingDemo
            ? ''
            : 'hover:bg-gray-50 dark:hover:bg-gray-890 cursor-pointer'
        "
        @click="existingDatabase"
      >
        <div
          class="
            w-8
            h-8
            rounded-full
            bg-green-500
            dark:bg-green-600
            relative
            flex-center
          "
        >
          <feather-icon
            name="upload"
            class="w-4 h-4 text-white dark:text-gray-900"
          />
        </div>
        <div>
          <p class="font-medium dark:text-gray-200">
            {{ t`Existing Company` }}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t`Load an existing company from your computer` }}
          </p>
        </div>
      </div>

      <!-- Create Demo (Pink Icon): same empty-state as New Company — only before any company file exists -->
      <div
        v-if="canShowDemo && filesLoaded && !files?.length"
        class="px-4 h-row-largest flex flex-row items-center gap-4 p-2"
        :class="
          creatingDemo
            ? ''
            : 'hover:bg-gray-50 dark:hover:bg-gray-890 cursor-pointer'
        "
        @click="createDemo"
      >
        <div
          class="
            w-8
            h-8
            rounded-full
            bg-pink-500
            dark:bg-pink-600
            relative
            flex-center
          "
        >
          <feather-icon name="monitor" class="w-4 h-4 text-white" />
        </div>
        <div>
          <p class="font-medium dark:text-gray-200">
            {{ t`Create Demo` }}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t`Create a demo company to try out Rukn Books` }}
          </p>
        </div>
      </div>
      <hr class="dark:border-gray-800" />

      <!-- File List -->
      <div
        v-if="filesLoaded && files?.length"
        class="overflow-y-auto"
        style="max-height: 340px"
      >
        <div
          v-for="(file, i) in files"
          :key="file.dbPath"
          class="h-row-largest px-4 flex gap-4 items-center"
          :class="
            creatingDemo
              ? ''
              : 'hover:bg-gray-50 dark:hover:bg-gray-890 cursor-pointer'
          "
          :title="t`${file.companyName} stored at ${file.dbPath}`"
          @click="selectFile(file)"
        >
          <div
            class="
              w-8
              h-8
              rounded-full
              flex
              justify-center
              items-center
              bg-gray-200
              dark:bg-gray-800
              text-gray-500
              font-semibold
              flex-shrink-0
              text-base
            "
          >
            {{ i + 1 }}
          </div>
          <div class="w-full">
            <div class="flex justify-between overflow-x-auto items-baseline">
              <h2 class="font-medium dark:text-gray-200">
                {{ file.companyName }}
              </h2>
              <p
                class="
                  whitespace-nowrap
                  text-sm text-gray-600
                  dark:text-gray-400
                "
              >
                {{ formatDate(file.modified) }}
              </p>
            </div>
            <p
              class="
                text-sm text-gray-600
                dark:text-gray-400
                overflow-x-auto
                no-scrollbar
                whitespace-nowrap
              "
            >
              {{ truncate(file.dbPath) }}
            </p>
          </div>
          <button
            class="
              ms-auto
              p-2
              hover:bg-red-200
              dark:hover:bg-red-900 dark:hover:bg-opacity-40
              rounded-full
              w-8
              h-8
              text-gray-600
              dark:text-gray-400
              hover:text-red-400
              dark:hover:text-red-200
            "
            @click.stop="() => deleteDb(i)"
          >
            <feather-icon name="x" class="w-4 h-4" />
          </button>
        </div>
      </div>
      <hr v-if="filesLoaded && files?.length" class="dark:border-gray-800" />

      <!-- Language Selector -->
      <div
        class="
          w-full
          flex
          justify-between
          items-center
          absolute
          p-4
          text-gray-900
          dark:text-gray-100
        "
        style="top: 100%; transform: translateY(-100%)"
      >
        <LanguageSelector v-show="!creatingDemo" class="text-sm w-28" />
        <button
          v-if="canShowDemo && filesLoaded && !files?.length"
          class="
            text-sm
            bg-gray-100
            dark:bg-gray-890
            hover:bg-gray-200
            dark:hover:bg-gray-900
            rounded
            px-4
            py-1.5
            w-auto
            h-8
            no-scrollbar
            overflow-x-auto
            whitespace-nowrap
          "
          :disabled="creatingDemo"
          @click="createDemo"
        >
          {{ creatingDemo ? t`Please Wait` : t`Create Demo` }}
        </button>
      </div>
    </div>
    <Loading
      v-if="creatingDemo"
      :open="creatingDemo"
      :show-x="false"
      :full-width="true"
      :percent="creationPercent"
      :message="creationMessage"
    />

    <Modal :open-modal="demoPickerOpen" @closemodal="demoPickerOpen = false">
      <div class="p-4 text-gray-900 dark:text-gray-100 w-form max-h-[420px] overflow-y-auto">
        <h2 class="text-xl font-semibold select-none">{{ t`Choose demo` }}</h2>
        <p class="text-sm mt-2 text-gray-600 dark:text-gray-400">
          {{ t`Pick a sample company or use the built-in English demo.` }}
        </p>
        <div class="mt-4 space-y-2">
          <button
            v-for="d in demoDatasets"
            :key="d.key"
            type="button"
            class="
              w-full text-start p-3 rounded-md border border-gray-200
              dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800
            "
            @click="selectServerDemo(d.key)"
          >
            <div class="font-medium dark:text-gray-200">{{ demoTitle(d) }}</div>
            <div class="text-sm text-gray-600 dark:text-gray-400">
              {{ demoDescription(d) }}
            </div>
          </button>
          <button
            type="button"
            class="
              w-full text-start p-3 rounded-md border border-gray-200
              dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800
            "
            @click="selectLocalDemo"
          >
            <div class="font-medium dark:text-gray-200">
              {{ t`Flo's Clothes (English, offline)` }}
            </div>
            <div class="text-sm text-gray-600 dark:text-gray-400">
              {{ t`Built-in sample company` }}
            </div>
          </button>
        </div>
        <div class="flex justify-end mt-6">
          <Button @click="demoPickerOpen = false">{{ t`Cancel` }}</Button>
        </div>
      </div>
    </Modal>

    <!-- Base Count Selection when Dev -->
    <Modal :open-modal="openModal" @closemodal="openModal = false">
      <div class="p-4 text-gray-900 dark:text-gray-100 w-form">
        <h2 class="text-xl font-semibold select-none">Set Base Count</h2>
        <p class="text-base mt-2">
          Base Count is a lower bound on the number of entries made when
          creating the dummy instance.
        </p>
        <div class="flex my-12 justify-center items-baseline gap-4 text-base">
          <label for="basecount" class="text-gray-600 dark:text-gray-400"
            >Base Count</label
          >
          <input
            v-model="baseCount"
            type="number"
            name="basecount"
            class="
              bg-gray-100
              dark:bg-gray-875
              focus:bg-gray-200
              dark:focus:bg-gray-890
              rounded-md
              px-2
              py-1
              outline-none
            "
          />
        </div>
        <div class="flex justify-between">
          <Button @click="openModal = false">Cancel</Button>
          <Button
            type="primary"
            @click="
              () => {
                openModal = false;
                startDummyInstanceSetup();
              }
            "
            >Create</Button
          >
        </div>
      </div>
    </Modal>

    <!-- ERPNext Import Settings -->
    <Modal
      :open-modal="openERPNextImportModal"
      @closemodal="openERPNextImportModal = false"
    >
      <div class="p-4 text-gray-900 dark:text-gray-100 w-form">
        <h2 class="text-xl font-semibold select-none">
          {{ t`ERPNext Import Settings` }}
        </h2>
        <p class="text-base mt-2 text-gray-700 dark:text-gray-400">
          {{
            t`Review or change your ERPNext API Base URL and Auth Token (API Key:API Secret). Values are remembered until you change them.`
          }}
        </p>

        <div class="mt-6 flex flex-col gap-4 text-base">
          <div class="flex flex-col gap-2">
            <label class="text-gray-600 dark:text-gray-400">{{
              t`API Base URL`
            }}</label>
            <input
              v-model="erpnextBaseURLInput"
              type="text"
              placeholder="https://your-site"
              class="
                bg-gray-100
                dark:bg-gray-875
                focus:bg-gray-200
                dark:focus:bg-gray-890
                rounded-md
                px-3
                py-2
                outline-none
              "
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-gray-600 dark:text-gray-400">{{
              t`Auth Token`
            }}</label>
            <input
              v-model="erpnextAuthTokenInput"
              type="password"
              placeholder="api_key:api_secret"
              class="
                bg-gray-100
                dark:bg-gray-875
                focus:bg-gray-200
                dark:focus:bg-gray-890
                rounded-md
                px-3
                py-2
                outline-none
              "
            />
          </div>
        </div>

        <div class="flex justify-between mt-8">
          <Button @click="openERPNextImportModal = false">{{
            t`Cancel`
          }}</Button>
          <Button type="primary" @click="saveERPNextImportSettings">{{
            t`Continue`
          }}</Button>
        </div>
      </div>
    </Modal>

    <!-- ERPNext company picker (Books list-style layout) -->
    <Modal
      :open-modal="openERPNextCompanyPickerModal"
      @closemodal="closeERPNextCompanyPicker"
    >
      <div
        class="
          p-4
          text-gray-900
          dark:text-gray-100
          flex flex-col
          w-form
          max-w-[90vw]
        "
        style="max-height: min(560px, 85vh)"
      >
        <h2 class="text-xl font-semibold select-none shrink-0">
          {{ t`Select ERPNext Company` }}
        </h2>
        <p class="text-sm mt-1 text-gray-600 dark:text-gray-400 shrink-0">
          {{ t`Click a row to select, then press Continue.` }}
        </p>

        <div class="text-base flex flex-col overflow-hidden flex-1 min-h-0 mt-4">
          <div
            class="flex items-center shrink-0"
            :style="{
              paddingRight:
                erpnextCompaniesList.length > 13 ? 'var(--w-scrollbar)' : '',
            }"
          >
            <div class="w-8 text-end me-2 text-gray-700 dark:text-gray-400">
              #
            </div>
            <Row
              class="flex-1 text-gray-700 dark:text-gray-400 h-row-mid"
              :column-count="3"
              gap="1rem"
            >
              <div
                class="
                  overflow-x-auto
                  no-scrollbar
                  whitespace-nowrap
                  h-row
                  items-center
                  flex
                  min-w-0
                "
              >
                {{ t`Company` }}
              </div>
              <div
                class="
                  overflow-x-auto
                  no-scrollbar
                  whitespace-nowrap
                  h-row
                  items-center
                  flex
                  min-w-0
                "
              >
                {{ t`Abbr` }}
              </div>
              <div
                class="
                  overflow-x-auto
                  no-scrollbar
                  whitespace-nowrap
                  h-row
                  items-center
                  flex
                  pe-4
                  min-w-0
                "
              >
                {{ t`Country` }}
              </div>
            </Row>
          </div>
          <hr class="dark:border-gray-800 shrink-0" />

          <div
            class="
              overflow-y-auto
              dark:dark-scroll
              custom-scroll custom-scroll-thumb1
              flex-1
              min-h-[12rem]
            "
          >
            <div
              v-for="(c, i) in erpnextCompaniesList"
              :key="c.name"
            >
              <div
                class="flex items-center cursor-pointer"
                :class="
                  erpnextPickerSelectedName === c.name
                    ? 'bg-blue-50 dark:bg-blue-950/40'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-850'
                "
                role="button"
                tabindex="0"
                @click="erpnextPickerSelectedName = c.name"
                @keydown.enter.prevent="erpnextPickerSelectedName = c.name"
              >
                <div class="w-8 text-end me-2 text-gray-700 dark:text-gray-400">
                  {{ i + 1 }}
                </div>
                <Row
                  class="flex-1 h-row-mid text-gray-900 dark:text-gray-300"
                  :column-count="3"
                  gap="1rem"
                >
                  <div class="min-w-0 truncate font-medium">{{ c.name }}</div>
                  <div class="min-w-0 truncate text-gray-600 dark:text-gray-400">
                    {{ c.abbr || '–' }}
                  </div>
                  <div
                    class="min-w-0 truncate pe-4 text-gray-600 dark:text-gray-400"
                  >
                    {{ c.country || '–' }}
                  </div>
                </Row>
              </div>
              <hr
                v-if="i !== erpnextCompaniesList.length - 1"
                class="dark:border-gray-800"
              />
            </div>
          </div>
        </div>

        <div class="flex justify-between mt-6 shrink-0">
          <Button @click="closeERPNextCompanyPicker">{{ t`Cancel` }}</Button>
          <Button
            type="primary"
            :disabled="!erpnextPickerSelectedName"
            @click="confirmERPNextCompanyPicker"
          >
            {{ t`Continue` }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
<script lang="ts">
import { setupDummyInstance } from 'dummy';
import type { DemoDatasetPayload } from 'dummy/types';

type DemoDatasetListRow = {
  key: string;
  title_en?: string;
  title_ar?: string;
  description_en?: string;
  description_ar?: string;
};
import { t } from 'fyo';
import { Verb } from 'fyo/telemetry/types';
import { DateTime } from 'luxon';
import Button from 'src/components/Button.vue';
import LanguageSelector from 'src/components/Controls/LanguageSelector.vue';
import FeatherIcon from 'src/components/FeatherIcon.vue';
import Loading from 'src/components/Loading.vue';
import Modal from 'src/components/Modal.vue';
import Row from 'src/components/Row.vue';
import { fyo } from 'src/initFyo';
import { showDialog } from 'src/utils/interactive';
import { sendAPIRequest } from 'src/utils/api';
import { setupInstanceFromERPNextTemplate } from 'src/setup/setupInstance';
import {
  initERPNSync,
  registerInstanceToERPNext,
  updateERPNSyncSettings,
} from 'src/utils/erpnextSync';
import { updateConfigFiles } from 'src/utils/misc';
import { deleteDb, getSavePath, getSelectedFilePath } from 'src/utils/ui';
import type { ConfigFilesWithModified } from 'utils/types';
import { defineComponent } from 'vue';

/** Shape of get_company_template payload while pending local DB creation. */
type ERPNextImportPendingTemplate = {
  company: {
    name: string;
    abbr?: string;
    company_name?: string;
    country?: string;
    default_currency?: string;
    time_zone?: string;
  };
  _connection?: {
    baseURL: string;
    token: string;
    company: string;
  };
  defaults?: Record<string, unknown>;
  fiscal_year?: {
    name?: string;
    year_start_date?: string;
    year_end_date?: string;
  } | null;
  item_tax_templates?: Array<{
    name: string;
    title?: string;
    rows: Array<{ tax_type: string; tax_rate?: number }>;
  }>;
  meta?: {
    accounts_parent_first?: boolean;
    accounts_parent_first_violations?: number;
    accounts_count?: number;
  };
  accounts: Array<{
    name: string;
    parent_account?: string | null;
    is_group?: number | boolean;
    root_type?: string;
    account_type?: string;
  }>;
};

type ERPNextCompanyPickerRow = {
  name: string;
  abbr?: string;
  default_currency?: string;
  country?: string;
};

function slugForDbFile(name: string): string {
  const s = name
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'company';
}

export default defineComponent({
  name: 'DatabaseSelector',
  components: {
    LanguageSelector,
    Loading,
    FeatherIcon,
    Modal,
    Button,
    Row,
  },
  emits: ['file-selected', 'new-database'],
  data() {
    return {
      openModal: false,
      erpnextImportAvailable: false,
      openERPNextImportModal: false,
      erpnextBaseURLInput: '',
      erpnextAuthTokenInput: '',
      baseCount: 100,
      creationMessage: '',
      creationPercent: 0,
      creatingDemo: false,
      loadingDatabase: false,
      filesLoaded: false,
      files: [],
      openERPNextCompanyPickerModal: false,
      erpnextCompaniesList: [] as ERPNextCompanyPickerRow[],
      erpnextPickerSelectedName: '',
      erpnextPickerBaseURL: '',
      erpnextPickerToken: '',
      erpnextImportPendingTemplate: null as ERPNextImportPendingTemplate | null,
      demoPickerOpen: false,
      demoDatasets: [] as DemoDatasetListRow[],
    } as {
      openModal: boolean;
      erpnextImportAvailable: boolean;
      openERPNextImportModal: boolean;
      erpnextBaseURLInput: string;
      erpnextAuthTokenInput: string;
      baseCount: number;
      creationMessage: string;
      creationPercent: number;
      creatingDemo: boolean;
      loadingDatabase: boolean;
      filesLoaded: boolean;
      files: ConfigFilesWithModified[];
      openERPNextCompanyPickerModal: boolean;
      erpnextCompaniesList: ERPNextCompanyPickerRow[];
      erpnextPickerSelectedName: string;
      erpnextPickerBaseURL: string;
      erpnextPickerToken: string;
      erpnextImportPendingTemplate: ERPNextImportPendingTemplate | null;
      demoPickerOpen: boolean;
      demoDatasets: DemoDatasetListRow[];
    };
  },
  computed: {
    /** Subscription flag; UI also requires empty file list (see template). */
    canShowDemo(): boolean {
      const feats = this.fyo.config.get('subscriptionFeatures');
      if (!feats || typeof feats !== 'object') {
        return false;
      }
      return Reflect.get(feats, 'enableDemo') === true;
    },
  },
  async mounted() {
    await this.setFiles();
    await this.checkERPNextImportAvailability();

    if (fyo.store.isDevelopment) {
      // @ts-ignore
      window.ds = this;
    }
  },
  async activated() {
    // This screen can be cached; re-check to pick up newly installed extensions.
    await this.checkERPNextImportAvailability();
  },
  methods: {
    saveERPNextImportSettings() {
      let baseURL = this.erpnextBaseURLInput.trim().replace(/\/$/, '');
      // Users sometimes paste full method base, normalize to site base.
      baseURL = baseURL.replace(/\/api\/method\/?$/, '');
      const token = this.erpnextAuthTokenInput.trim();

      if (!baseURL || !token) {
        void showDialog({
          title: this.t`Missing values`,
          detail: this.t`Please enter both API Base URL and Auth Token.`,
          type: 'warning',
        });
        return;
      }

      this.fyo.config.set('erpnextImportBaseURL' as any, baseURL);
      this.fyo.config.set('erpnextImportAuthToken' as any, token);
      this.openERPNextImportModal = false;

      void this.runERPNextImportFlow(baseURL, token);
    },
    async checkERPNextImportAvailability() {
      try {
        const ext = await import('books-erpnext-sync-extended');
        const mod = (ext as any)?.default ?? ext;
        const hasExports =
          typeof mod?.getERPNextCompanies === 'function' ||
          typeof mod?.getERPNextCompanyTemplate === 'function' ||
          typeof mod?.createLocalCompanyFromTemplate === 'function';
        this.erpnextImportAvailable = !!hasExports;
      } catch {
        this.erpnextImportAvailable = false;
      }
    },
    truncate(value: string) {
      if (value.length < 72) {
        return value;
      }

      return '...' + value.slice(value.length - 72);
    },
    formatDate(isoDate: string) {
      return DateTime.fromISO(isoDate).toRelative();
    },
    async deleteDb(i: number) {
      const file = this.files[i];
      const setFiles = this.setFiles.bind(this);

      await showDialog({
        title: t`Delete ${file.companyName}?`,
        detail: t`Database file: ${file.dbPath}`,
        type: 'warning',
        buttons: [
          {
            label: this.t`Yes`,
            async action() {
              await deleteDb(file.dbPath);
              await setFiles();
            },
            isPrimary: true,
          },
          {
            label: this.t`No`,
            action() {
              return null;
            },
            isEscape: true,
          },
        ],
      });
    },
    demoTitle(d: DemoDatasetListRow): string {
      const lang = String(this.fyo.config.get('language') || 'en');
      if (lang.startsWith('ar') && d.title_ar) {
        return d.title_ar;
      }
      return d.title_en || d.key;
    },
    demoDescription(d: DemoDatasetListRow): string {
      const lang = String(this.fyo.config.get('language') || 'en');
      if (lang.startsWith('ar') && d.description_ar) {
        return d.description_ar;
      }
      return d.description_en || '';
    },
    async selectServerDemo(key: string) {
      this.demoPickerOpen = false;
      let res;
      try {
        res = await ipc.getDemoDataset(key);
      } catch (err) {
        await showDialog({
          title: this.t`Could not load demo`,
          detail: err instanceof Error ? err.message : String(err),
          type: 'error',
        });
        return;
      }
      if (!res?.success || !res.payload) {
        await showDialog({
          title: this.t`Could not load demo`,
          detail: res?.message ?? this.t`Unknown error`,
          type: 'warning',
        });
        return;
      }
      await this.startDummyInstanceSetup(res.payload as DemoDatasetPayload);
    },
    selectLocalDemo() {
      this.demoPickerOpen = false;
      void this.startDummyInstanceSetup(null);
    },
    async createDemo() {
      if (!this.canShowDemo) {
        await showDialog({
          title: this.t`Demo not available`,
          detail: this.t`Demo datasets are not enabled for your subscription.`,
          type: 'info',
        });
        return;
      }

      let listRes;
      try {
        listRes = await ipc.listDemoDatasets();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('ipc.listDemoDatasets failed', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        /* eslint-disable prettier/prettier -- multi-line translated detail + error suffix */
        await showDialog({
          title: this.t`Using offline demo`,
          detail:
            this.t`Could not load demo list from the server. Creating the built-in sample company.` +
            `\n${errMsg}`,
          type: 'info',
        });
        /* eslint-enable prettier/prettier */
        await this.startDummyInstanceSetup(null);
        return;
      }

      if (listRes.success && listRes.datasets?.length) {
        this.demoDatasets = listRes.datasets as DemoDatasetListRow[];
        this.demoPickerOpen = true;
        return;
      }
      await showDialog({
        title: this.t`Using offline demo`,
        detail:
          listRes.message ||
          this.t`Could not load demo list from the server. Creating the built-in sample company.`,
        type: 'info',
      });
      await this.startDummyInstanceSetup(null);
    },
    async startDummyInstanceSetup(demoPayload?: DemoDatasetPayload | null) {
      const { filePath, canceled } = await getSavePath('demo', 'db');
      if (canceled || !filePath) {
        return;
      }

      this.creatingDemo = true;
      await setupDummyInstance(
        filePath,
        fyo,
        1,
        this.baseCount,
        (message, percent) => {
          this.creationMessage = message;
          this.creationPercent = percent;
        },
        demoPayload ?? undefined
      );

      updateConfigFiles(fyo, {
        isDemo: true,
        demoKey: demoPayload?.key ?? 'flo-clothes',
      });
      await fyo.purgeCache();
      await this.setFiles();
      this.fyo.telemetry.log(Verb.Created, 'dummy-instance');
      this.creatingDemo = false;
      this.$emit('file-selected', filePath);
    },
    async setFiles() {
      try {
        const dbList = await ipc.getDbList();
        this.files =
          dbList?.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)) ??
          [];
      } finally {
        this.filesLoaded = true;
      }
    },
    newDatabase() {
      if (this.creatingDemo) {
        return;
      }

      this.$emit('new-database');
    },
    async fromERPNextCompany() {
      if (this.creatingDemo) {
        return;
      }

      if (!this.erpnextImportAvailable) {
        await showDialog({
          title: this.t`ERPNext import not available`,
          detail: this.t`Please update/install books-erpnext-sync-extended.`,
          type: 'info',
        });
        return;
      }

      this.erpnextBaseURLInput =
        (this.fyo.config.get('erpnextImportBaseURL' as any) as string | undefined) ??
        '';
      this.erpnextAuthTokenInput =
        (this.fyo.config.get('erpnextImportAuthToken' as any) as
          | string
          | undefined) ?? '';
      this.openERPNextImportModal = true;
    },
    async runERPNextImportFlow(baseURL: string, token: string) {
      const ext = await import('books-erpnext-sync-extended');
      const mod = (ext as any)?.default ?? ext;
      const getERPNextCompanies = mod
        ?.getERPNextCompanies as
        | undefined
        | ((params: {
            baseURL: string;
            token: string;
            sendAPIRequest: typeof sendAPIRequest;
          }) => Promise<ERPNextCompanyPickerRow[]>);

      if (!getERPNextCompanies) {
        await showDialog({
          title: this.t`ERPNext import not available`,
          detail: this.t`Please update/install books-erpnext-sync-extended.`,
          type: 'info',
        });
        return;
      }

      let companies: ERPNextCompanyPickerRow[] = [];
      try {
        companies = await getERPNextCompanies({ baseURL, token, sendAPIRequest });
      } catch (error) {
        if (this.fyo.store.isDevelopment) {
          // eslint-disable-next-line no-console
          console.error('ERPNext import: get_companies failed', error);
        }
        const message = error instanceof Error ? error.message : String(error);
        await showDialog({
          title: this.t`Failed to fetch companies`,
          detail: message,
          detailIsHtml: true,
          type: 'error',
        });
        return;
      }

      if (!companies.length) {
        await showDialog({
          title: this.t`No companies found`,
          detail: this.t`The ERPNext user for this token cannot read any Company.`,
          type: 'info',
        });
        return;
      }

      this.erpnextCompaniesList = companies;
      this.erpnextPickerBaseURL = baseURL;
      this.erpnextPickerToken = token;
      this.erpnextPickerSelectedName =
        companies.length === 1 ? companies[0].name : '';
      this.openERPNextCompanyPickerModal = true;
    },
    closeERPNextCompanyPicker() {
      this.openERPNextCompanyPickerModal = false;
      this.erpnextCompaniesList = [];
      this.erpnextPickerSelectedName = '';
      this.erpnextPickerBaseURL = '';
      this.erpnextPickerToken = '';
    },
    async confirmERPNextCompanyPicker() {
      const picked = this.erpnextPickerSelectedName;
      if (!picked) {
        return;
      }
      const baseURL = this.erpnextPickerBaseURL;
      const token = this.erpnextPickerToken;
      this.openERPNextCompanyPickerModal = false;
      this.erpnextCompaniesList = [];
      this.erpnextPickerSelectedName = '';
      this.erpnextPickerBaseURL = '';
      this.erpnextPickerToken = '';
      await this.fetchERPNextTemplateAndSummarize({
        baseURL,
        token,
        picked,
      });
    },
    async fetchERPNextTemplateAndSummarize({
      baseURL,
      token,
      picked,
    }: {
      baseURL: string;
      token: string;
      picked: string;
    }) {
      const ext = await import('books-erpnext-sync-extended');
      const mod = (ext as any)?.default ?? ext;
      const getERPNextCompanyTemplate = mod
        ?.getERPNextCompanyTemplate as
        | undefined
        | ((params: {
            baseURL: string;
            token: string;
            company: string;
            sendAPIRequest: typeof sendAPIRequest;
          }) => Promise<{
            company: { name: string };
            meta?: {
              accounts_parent_first?: boolean;
              accounts_parent_first_violations?: number;
              accounts_count?: number;
            };
            accounts: Array<unknown>;
          }>);

      if (!getERPNextCompanyTemplate) {
        await showDialog({
          title: this.t`ERPNext template import not available`,
          detail: this.t`Please update/install books-erpnext-sync-extended.`,
          type: 'info',
        });
        return;
      }

      let template:
        | {
            company: { name: string };
            meta?: {
              accounts_parent_first?: boolean;
              accounts_parent_first_violations?: number;
              accounts_count?: number;
            };
            accounts: Array<unknown>;
          }
        | undefined;
      try {
        template = await getERPNextCompanyTemplate({
          baseURL,
          token,
          company: picked,
          sendAPIRequest,
        });
      } catch (error) {
        if (this.fyo.store.isDevelopment) {
          // eslint-disable-next-line no-console
          console.error('ERPNext import: get_company_template failed', error);
        }
        const message = error instanceof Error ? error.message : String(error);
        await showDialog({
          title: this.t`Failed to fetch company template`,
          detail: message,
          detailIsHtml: true,
          type: 'error',
        });
        return;
      }

      const meta = template?.meta ?? {};
      const accountsCount =
        meta.accounts_count ?? template?.accounts?.length ?? 0;
      const parentFirst = meta.accounts_parent_first;
      const violations = meta.accounts_parent_first_violations ?? 0;

      this.erpnextImportPendingTemplate =
        {
          ...(template as ERPNextImportPendingTemplate),
          _connection: { baseURL, token, company: picked },
        };

      const createLocal = await showDialog({
        title: this.t`Template fetched`,
        detail: [
          this.t`Company: ${picked}`,
          this.t`Accounts: ${accountsCount}`,
          typeof parentFirst === 'boolean'
            ? this.t`Parent-first order: ${parentFirst ? 'Yes' : 'No'}`
            : this.t`Parent-first order: Unknown`,
          violations ? this.t`Order violations: ${violations}` : this.t``,
        ].filter(Boolean),
        type: parentFirst === false ? 'warning' : 'success',
        buttons: [
          {
            label: this.t`Create company file`,
            action: () => true,
            isPrimary: true,
          },
          {
            label: this.t`Done`,
            action: () => false,
            isEscape: true,
          },
        ],
      });

      if (createLocal) {
        await this.runCreateDatabaseFromERPNextTemplate();
      } else {
        this.erpnextImportPendingTemplate = null;
      }
    },
    async runCreateDatabaseFromERPNextTemplate() {
      const template = this.erpnextImportPendingTemplate;
      if (!template?.company || !template.accounts?.length) {
        await showDialog({
          title: this.t`Nothing to import`,
          type: 'warning',
          detail: this.t`The ERPNext template was missing data. Fetch the template again.`,
        });
        return;
      }
      const conn = template._connection;
      if (!conn?.baseURL || !conn?.token || !conn?.company) {
        await showDialog({
          title: this.t`Missing ERPNext connection`,
          type: 'warning',
          detail: this.t`Please fetch the ERPNext template again.`,
        });
        return;
      }

      const slug = slugForDbFile(
        template.company.company_name || template.company.name || 'company'
      );
      const { filePath, canceled } = await getSavePath(slug, 'db');
      if (canceled || !filePath) {
        return;
      }

      this.creatingDemo = true;
      this.creationMessage = this.t`Creating company from ERPNext…`;
      this.creationPercent = 0;

      try {
        await setupInstanceFromERPNextTemplate(
          filePath,
          { ...template, _connection: conn },
          fyo
        );
        updateConfigFiles(fyo);
        // Immediately pull data from ERPNext after import (no manual click).
        try {
          await registerInstanceToERPNext(fyo);
          await updateERPNSyncSettings(fyo);
          const syncSettings = await fyo.doc.getDoc('ERPNextSyncSettings');
          if (!(syncSettings as any)?.isEnabled) {
            await showDialog({
              title: this.t`ERPNext sync is disabled`,
              type: 'warning',
              detail: this.t`Enable "Enable Sync" in ERPNext → Books Sync Settings, then try again.`,
            });
          } else {
            await initERPNSync(fyo);
          }
        } catch (e) {
          if (this.fyo.store.isDevelopment) {
            // eslint-disable-next-line no-console
            console.error('ERPNext import: auto-sync after import failed', e);
          }
        }
        await fyo.purgeCache();
        this.erpnextImportPendingTemplate = null;
        this.$emit('file-selected', filePath);
      } catch (error) {
        if (this.fyo.store.isDevelopment) {
          // eslint-disable-next-line no-console
          console.error('ERPNext import: create local company failed', error);
        }
        const message = error instanceof Error ? error.message : String(error);
        await showDialog({
          title: this.t`Could not create company`,
          detail: message,
          type: 'error',
        });
      } finally {
        this.creatingDemo = false;
        this.creationPercent = 0;
        this.creationMessage = '';
      }
    },
    async existingDatabase() {
      if (this.creatingDemo) {
        return;
      }

      const filePath = (await getSelectedFilePath())?.filePaths?.[0];
      this.emitFileSelected(filePath);
    },
    selectFile(file: ConfigFilesWithModified) {
      if (this.creatingDemo) {
        return;
      }

      this.emitFileSelected(file.dbPath);
    },
    emitFileSelected(filePath: string) {
      if (!filePath) {
        return;
      }

      this.$emit('file-selected', filePath);
    },
  },
});
</script>
