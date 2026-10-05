import { use, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@pillage-first/utils/format';
import { OverflowContainer } from 'app/(game)/(village-slug)/components/building-layout';
import { Text } from 'app/components/text';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from 'app/components/ui/table';
import { CombatSimulatorContext } from '../providers/combat-simulator-context';
import {
  type SimulatedUnitResult,
  simulateCombat,
} from '../utils/simulate-combat';

type ResultTableProps = {
  title: string;
  units: SimulatedUnitResult[];
  heroDamage: number | null;
  showTrapped?: boolean;
};

const ResultTable = ({
  title,
  units,
  heroDamage,
  showTrapped = false,
}: ResultTableProps) => {
  const { t } = useTranslation();

  if (units.length === 0 && heroDamage === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <Text as="h3">{title}</Text>
      <OverflowContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t('Unit')}</TableHeaderCell>
              <TableHeaderCell>{t('Before')}</TableHeaderCell>
              {showTrapped && <TableHeaderCell>{t('Trapped')}</TableHeaderCell>}
              <TableHeaderCell>{t('Lost')}</TableHeaderCell>
              <TableHeaderCell>{t('After')}</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((unit) => (
              <TableRow key={unit.unitId}>
                <TableCell>{t(`UNITS.${unit.unitId}.NAME`)}</TableCell>
                <TableCell>{formatNumber(unit.amountBefore)}</TableCell>
                {showTrapped && (
                  <TableCell>{formatNumber(unit.amountTrapped)}</TableCell>
                )}
                <TableCell>{formatNumber(unit.amountLost)}</TableCell>
                <TableCell>{formatNumber(unit.amountAfter)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </OverflowContainer>
      {heroDamage !== null && (
        <Text>
          {t('Hero loses {{amount}} health', {
            amount: formatNumber(heroDamage),
          })}
        </Text>
      )}
    </div>
  );
};

export const CombatSimulatorResults = () => {
  const { t } = useTranslation();
  const { state } = use(CombatSimulatorContext)!;

  const result = useMemo(() => simulateCombat(state), [state]);

  if (result === null) {
    return <Text>{t('Add attacking troops to see the battle outcome.')}</Text>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Text as="h2">{t('Result')}</Text>
      <Text>
        {result.hasAttackerWon
          ? t('The attacker wins.')
          : t('The defender wins.')}{' '}
        {t('Attack points: {{attack}}, defence points: {{defence}}', {
          attack: formatNumber(result.attackerPoints),
          defence: formatNumber(result.defenderPoints),
        })}
      </Text>
      <ResultTable
        title={t('Attacker')}
        units={result.attacker}
        heroDamage={result.attackerHeroDamage}
        showTrapped={state.defender.village.trapCount > 0}
      />
      <ResultTable
        title={t('Defender')}
        units={result.defender}
        heroDamage={result.defenderHeroDamage}
      />
      {result.reinforcements.map((units, index) => (
        <ResultTable
          key={state.defender.reinforcements[index]?.id ?? index}
          title={t('Reinforcement {{number}}', { number: index + 1 })}
          units={units}
          heroDamage={null}
        />
      ))}
    </div>
  );
};
