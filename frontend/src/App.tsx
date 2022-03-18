import React, { useEffect, useState } from 'react';
import './App.css';
import config from './config';
import { Column, useTable } from 'react-table'

const axios = require('axios');


function App() {
  const [tableData, setTableData] = useState<any[]>([]);
  const [refreshRequested, setRefreshRequested] = useState(false);

  useEffect(() => {
    async function onLoad() {
      try {
        const response = await axios.get(config.API_URL + 'api/');
        if (response.data) {
          setTableData(response.data)
        }
      } catch (error) {
        console.error(error);
      }
      setRefreshRequested(false);
    }
    onLoad();
  }, [refreshRequested]);

  function DynamoDbItemToString(item: ({ [k: string]: {}[] })): (string | string[]) {
    const key = Object.keys(item)[0];
    if (key === 'L') {
      return item[key].map((i: any) => {
        return DynamoDbItemToString(i);
      }).flat();
    } else {
      return item[key].toString()
    }
  }

  const columns = React.useMemo<Column[]>(
    () =>
      ['pk', 'sk', 'SourceMapsEnabled', 'Date', 'Architectures', 'MemorySize', 'Description', 'CodeSize', 'FunctionName', 'ColdStarts coldStartPercent', 'ColdStarts median', 'ColdStarts mean', 'ColdStarts p90', 'Runtime', 'Durations median', 'Durations mean', 'Durations p90'].map(item => ({
        Header: item, accessor: (row: any, index: number) => {

          if (item.includes(" ")) {
            let thisItem = row;

            // for nested items in the dataset, splitting the header value by a space and then using those keys to traverse the tree
            return item.split(' ').map(a => {
              try {
                thisItem = thisItem[a];
                const key = Object.keys(thisItem)[0];
                thisItem = thisItem[key];

                return thisItem;
              } catch (error) {
                console.error(error);
                return '';
              }
            }).pop();
          } else {
            return DynamoDbItemToString(row[item]);
          }
        }
      }))
    // TODO: figure out how to not need this eslint exception
    // eslint-disable-next-line react-hooks/exhaustive-deps
    , []
  );

  const data = React.useMemo(
    () => {
      let data: any[] = [];
      if (tableData) {
        data = tableData;
      }
      return data;
    },
    [tableData]
  )

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    rows,
    prepareRow,
  } = useTable({ columns, data })

  return (
    <div className="App">
      <button onClick={() => setRefreshRequested(true)}>Refresh</button>
      <table {...getTableProps()}>
        <thead>
          {headerGroups.map(headerGroup => (
            <tr {...headerGroup.getHeaderGroupProps()}>
              {headerGroup.headers.map(column => (
                <th {...column.getHeaderProps()}>
                  {column.render('Header')}
                </th>))}
            </tr>
          ))}
        </thead>
        <tbody {...getTableBodyProps()}>
          {rows.map(row => {
            prepareRow(row)
            try {
              return (
                <tr {...row.getRowProps()}>
                  {row.cells.map(cell => {
                    return (
                      <td {...cell.getCellProps()}>
                        {cell.render('Cell')}
                      </td>)
                  })}
                </tr>
              )
            }
            catch {
              return <tr></tr>;
            }
          })}
        </tbody>
      </table>
    </div>
  )
};

export default App;
