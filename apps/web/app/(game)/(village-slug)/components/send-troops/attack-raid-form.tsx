import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  Section,
  SectionContent,
} from 'app/(game)/(village-slug)/components/building-layout';
import { usePreferences } from 'app/(game)/(village-slug)/hooks/use-preferences';
import { Text } from 'app/components/text';
import { Button } from 'app/components/ui/button';
import { AttackOrRaidActionSelector } from './components/attack-or-raid-action-selector';
import {
  AttackOrRaidCatapultTargetOptions,
  AttackOrRaidConfirmationOptions,
} from './components/attack-or-raid-confirmation-options';
import { TroopMovementConfirmationModal } from './components/confirmation-modal';
import { TroopSelectionForm } from './components/troop-selection-form';
import { useAttackOrRaidForm } from './hooks/use-attack-or-raid-form';

export const AttackRaidForm = () => {
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const navigate = useNavigate();
  const {
    catapultTargetBuildingIds,
    confirmationOption,
    disabledUnitTiers,
    isConfirmDisabled,
    tribe,
    closeConfirmationStep,
    form,
    formData,
    isConfirmationStepOpen,
    onConfirm,
    onFormSubmit,
  } = useAttackOrRaidForm({
    onSuccess: () => {
      if (preferences.isAutomaticNavigationAfterSendUnitsEnabled) {
        navigate('..', { relative: 'path' });
      }
    },
  });

  return (
    <Section>
      <SectionContent>
        <Text as="h2">{t('Attack or raid')}</Text>
      </SectionContent>
      <SectionContent>
        <TroopSelectionForm
          form={form}
          onSubmit={onFormSubmit}
          units={{ disabledUnitTiers }}
          target={{
            selector: 'coordinates',
            extraContent: <AttackOrRaidActionSelector />,
          }}
          footer={{
            content: <Button type="submit">{t('Confirm')}</Button>,
          }}
        />
        {formData.current ? (
          <TroopMovementConfirmationModal
            isOpen={isConfirmationStepOpen}
            onClose={closeConfirmationStep}
            onConfirm={onConfirm}
            formData={formData.current}
            tribe={tribe}
            title={
              formData.current.action === 'attack' ? t('Attack') : t('Raid')
            }
            backLabel={t('Back')}
            isConfirmDisabled={isConfirmDisabled}
            unitTableDetails={
              confirmationOption?.type === 'catapultTargets' ? (
                <AttackOrRaidCatapultTargetOptions
                  catapultTargetBuildingIds={catapultTargetBuildingIds}
                  form={form}
                  targetCount={confirmationOption.targetCount}
                />
              ) : confirmationOption ? (
                <AttackOrRaidConfirmationOptions
                  confirmationOption={confirmationOption}
                  form={form}
                />
              ) : undefined
            }
            unitTableDetailsLabel={t('Target')}
          />
        ) : null}
      </SectionContent>
    </Section>
  );
};
